import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";

const AUTHORIZE_URL = "https://www.tiktok.com/v2/auth/authorize/";
const TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/";
export const TIKTOK_SCOPES = ["user.info.basic", "video.publish"];
const REFRESH_MARGIN_MS = 10 * 60 * 1000;

const tokenResponseSchema = z.object({
  access_token: z.string(),
  expires_in: z.number(),
  refresh_token: z.string(),
  refresh_expires_in: z.number(),
  open_id: z.string(),
  scope: z.string(),
});

const storedSchema = z.object({
  accessToken: z.string(),
  expiresAt: z.string(),
  refreshToken: z.string(),
  refreshExpiresAt: z.string(),
  openId: z.string(),
  scope: z.string(),
});
type Stored = z.infer<typeof storedSchema>;

export type TikTokAuthOptions = {
  clientKey: string;
  clientSecret: string;
  redirectUri: string;
  tokensPath: string;
  fetchImpl?: typeof fetch;
};

/** OAuth 2 do TikTok (Login Kit) com PKCE; persiste e renova tokens. */
export class TikTokAuth {
  private tokens: Stored | undefined;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: TikTokAuthOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.tokens = this.load();
  }

  get isLoggedIn(): boolean {
    return this.tokens !== undefined;
  }

  /** Gera URL de autorização e o code_verifier correspondente (guarde até o callback). */
  authorizationUrl(): { url: string; codeVerifier: string; state: string } {
    const codeVerifier = randomBytes(48).toString("base64url");
    const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
    const state = randomBytes(12).toString("hex");
    const params = new URLSearchParams({
      client_key: this.options.clientKey,
      scope: TIKTOK_SCOPES.join(","),
      response_type: "code",
      redirect_uri: this.options.redirectUri,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    });
    return { url: `${AUTHORIZE_URL}?${params}`, codeVerifier, state };
  }

  async exchangeCode(code: string, codeVerifier: string): Promise<void> {
    await this.requestToken({
      client_key: this.options.clientKey,
      client_secret: this.options.clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: this.options.redirectUri,
      code_verifier: codeVerifier,
    });
  }

  async getAccessToken(): Promise<string> {
    if (!this.tokens) {
      throw new Error("TikTok não autorizado. Rode `npm run tiktok:login`.");
    }
    if (new Date(this.tokens.expiresAt).getTime() - REFRESH_MARGIN_MS > Date.now()) {
      return this.tokens.accessToken;
    }
    if (new Date(this.tokens.refreshExpiresAt).getTime() < Date.now()) {
      throw new Error("Refresh token do TikTok expirou. Rode `npm run tiktok:login` de novo.");
    }
    await this.requestToken({
      client_key: this.options.clientKey,
      client_secret: this.options.clientSecret,
      grant_type: "refresh_token",
      refresh_token: this.tokens.refreshToken,
    });
    return (this.tokens as Stored).accessToken;
  }

  private async requestToken(body: Record<string, string>): Promise<void> {
    const response = await this.fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body),
    });
    const json: unknown = await response.json();
    const parsed = tokenResponseSchema.safeParse(json);
    if (!parsed.success) {
      throw new Error(`Token do TikTok falhou (${response.status}): ${JSON.stringify(json).slice(0, 300)}`);
    }
    const now = Date.now();
    this.tokens = {
      accessToken: parsed.data.access_token,
      expiresAt: new Date(now + parsed.data.expires_in * 1000).toISOString(),
      refreshToken: parsed.data.refresh_token,
      refreshExpiresAt: new Date(now + parsed.data.refresh_expires_in * 1000).toISOString(),
      openId: parsed.data.open_id,
      scope: parsed.data.scope,
    };
    mkdirSync(dirname(this.options.tokensPath), { recursive: true });
    writeFileSync(this.options.tokensPath, JSON.stringify(this.tokens, null, 2), { mode: 0o600 });
  }

  private load(): Stored | undefined {
    if (!existsSync(this.options.tokensPath)) {
      return undefined;
    }
    return storedSchema.parse(JSON.parse(readFileSync(this.options.tokensPath, "utf8")));
  }
}
