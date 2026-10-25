import type { z } from "zod";
import { sleep } from "../../util/concurrency.js";
import type { MlAuth } from "./auth.js";

const API_BASE = "https://api.mercadolibre.com";
const MAX_ATTEMPTS = 3;

export class MlHttpError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    body: string,
  ) {
    super(`Mercado Livre ${status} em ${path}: ${body.slice(0, 200)}`);
  }
}

/** Cliente HTTP mínimo da API do ML: auth, retry em 429/5xx e validação com zod. */
export class MlClient {
  constructor(
    private readonly auth: MlAuth,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async get<S extends z.ZodTypeAny>(path: string, schema: S): Promise<z.infer<S>> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const token = await this.auth.getAccessToken();
      const response = await this.fetchImpl(`${API_BASE}${path}`, {
        headers: { accept: "application/json", authorization: `Bearer ${token}` },
      });

      if (response.ok) {
        return schema.parse(await response.json());
      }

      const body = await response.text();
      lastError = new MlHttpError(response.status, path, body);

      if (response.status === 401 && attempt < MAX_ATTEMPTS) {
        await this.auth.refresh();
        continue;
      }
      if ((response.status === 429 || response.status >= 500) && attempt < MAX_ATTEMPTS) {
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      throw lastError;
    }

    throw lastError;
  }
}
