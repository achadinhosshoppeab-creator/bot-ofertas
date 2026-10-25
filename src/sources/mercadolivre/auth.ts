import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";

const TOKEN_URL = "https://api.mercadolibre.com/oauth/token";
/** Renova com folga antes de expirar (tokens do ML duram 6h). */
const REFRESH_MARGIN_MS = 10 * 60 * 1000;

const tokenResponseSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  expires_in: z.number(),
});

const storedTokensSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresAt: z.string(),
});

type StoredTokens = z.infer<typeof storedTokensSchema>;

export type MlAuthOptions = {
  clientId: string;
  clientSecret: string;
  /** Refresh token inicial (do .env), usado só se ainda não houver arquivo de tokens. */
  initialRefreshToken: string;
  /** Onde persistir os tokens renovados (o refresh token do ML é de uso único). */
  tokensPath: string;
  fetchImpl?: typeof fetch;
};

export class MlAuth {
  private tokens: StoredTokens | undefined;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: MlAuthOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.tokens = this.load();
  }

  async getAccessToken(): Promise<string> {
    if (
      this.tokens &&
      new Date(this.tokens.expiresAt).getTime() - REFRESH_MARGIN_MS > Date.now()
    ) {
      return this.tokens.accessToken;
    }
    return this.refresh();
  }

  async refresh(): Promise<string> {
    const refreshToken =
      this.tokens?.refreshToken ?? this.options.initialRefreshToken;
    if (!refreshToken || !this.options.clientId || !this.options.clientSecret) {
      throw new Error(
        "Credenciais do Mercado Livre ausentes (ML_CLIENT_ID, ML_CLIENT_SECRET, ML_REFRESH_TOKEN).",
      );
    }

    const response = await this.fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: this.options.clientId,
        client_secret: this.options.clientSecret,
        refresh_token: refreshToken,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Falha ao renovar token do Mercado Livre (${response.status}): ${body}`,
      );
    }

    const data = tokenResponseSchema.parse(await response.json());
    this.tokens = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: new Date(Date.now() + data.expires_in * 1000).toISOString(),
    };
    this.save(this.tokens);
    return this.tokens.accessToken;
  }

  private load(): StoredTokens | undefined {
    if (!existsSync(this.options.tokensPath)) {
      return undefined;
    }
    const json: unknown = JSON.parse(
      readFileSync(this.options.tokensPath, "utf8"),
    );
    return storedTokensSchema.parse(json);
  }

  private save(tokens: StoredTokens): void {
    mkdirSync(dirname(this.options.tokensPath), { recursive: true });
    writeFileSync(this.options.tokensPath, JSON.stringify(tokens, null, 2), {
      encoding: "utf8",
      mode: 0o600,
    });
  }
}
