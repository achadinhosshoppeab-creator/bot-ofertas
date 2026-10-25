import { createHash } from "node:crypto";
import type { z } from "zod";
import { sleep } from "../../util/concurrency.js";

const ENDPOINT = "https://open-api.affiliate.shopee.com.br/graphql";
const MAX_ATTEMPTS = 3;

/** Cliente GraphQL da Open API de Afiliados Shopee (assinatura SHA256 por requisição). */
export class ShopeeClient {
  constructor(
    private readonly appId: string,
    private readonly secret: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    if (!appId || !secret) {
      throw new Error("Credenciais da Shopee ausentes (SHOPEE_APP_ID, SHOPEE_SECRET).");
    }
  }

  async query<S extends z.ZodTypeAny>(query: string, schema: S): Promise<z.infer<S>> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const payload = JSON.stringify({ query });
      const timestamp = Math.floor(Date.now() / 1000);
      const signature = createHash("sha256")
        .update(`${this.appId}${timestamp}${payload}${this.secret}`)
        .digest("hex");

      const response = await this.fetchImpl(ENDPOINT, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `SHA256 Credential=${this.appId}, Timestamp=${timestamp}, Signature=${signature}`,
        },
        body: payload,
      });
      const body = (await response.json()) as { data?: unknown; errors?: Array<{ message: string }> };

      if (response.ok && !body.errors?.length) {
        return schema.parse(body.data);
      }

      lastError = new Error(
        `Shopee ${response.status}: ${body.errors?.map((e) => e.message).join("; ") ?? "erro desconhecido"}`,
      );
      if ((response.status === 429 || response.status >= 500) && attempt < MAX_ATTEMPTS) {
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      throw lastError;
    }

    throw lastError;
  }
}
