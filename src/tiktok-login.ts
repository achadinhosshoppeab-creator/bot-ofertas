/**
 * Login único no TikTok (OAuth) em duas etapas, porque o redirect pode cair numa página
 * externa (ex.: https://<site>/callback.html), que só mostra a URL para colar aqui.
 *
 *   npm run tiktok:login                      → imprime a URL de autorização e guarda o PKCE pendente
 *   npm run tiktok:login -- "<URL do callback>" → troca o code pelo token
 *
 * Se o redirect for localhost, a primeira etapa também sobe um servidor e termina sozinha.
 */
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { loadConfig } from "./config.js";
import { TikTokAuth, TikTokPublisher } from "./publishers/tiktok/index.js";

const { env } = loadConfig();
const auth = new TikTokAuth({
  clientKey: env.TIKTOK_CLIENT_KEY,
  clientSecret: env.TIKTOK_CLIENT_SECRET,
  redirectUri: env.TIKTOK_REDIRECT_URI,
  tokensPath: resolve(env.TIKTOK_TOKENS_PATH),
});
const pendingPath = resolve(env.TIKTOK_TOKENS_PATH).replace(/\.json$/, "-pending.json");

async function finish(callback: URL, codeVerifier: string, state: string): Promise<void> {
  const code = callback.searchParams.get("code");
  if (!code || callback.searchParams.get("state") !== state) {
    throw new Error(`Callback inválido (code ausente ou state diferente): ${callback.toString()}`);
  }
  await auth.exchangeCode(code, codeVerifier);
  if (existsSync(pendingPath)) {
    unlinkSync(pendingPath);
  }
  const info = await new TikTokPublisher(auth).creatorInfo();
  console.log(`\nAutorizado como @${info.creator_username ?? "?"}. Privacidades permitidas: ${info.privacy_level_options.join(", ")}`);
}

const pasted = process.argv[2];
if (pasted) {
  if (!existsSync(pendingPath)) {
    throw new Error("Nenhum login pendente: rode `npm run tiktok:login` sem argumentos primeiro.");
  }
  const pending = JSON.parse(readFileSync(pendingPath, "utf8")) as { codeVerifier: string; state: string };
  await finish(new URL(pasted.trim()), pending.codeVerifier, pending.state);
  process.exit(0);
}

const { url, codeVerifier, state } = auth.authorizationUrl();
writeFileSync(pendingPath, JSON.stringify({ codeVerifier, state, createdAt: new Date().toISOString() }), { mode: 0o600 });
console.log("\nAbra no navegador (logado na conta do TikTok da marca):\n\n" + url + "\n");

const redirect = new URL(env.TIKTOK_REDIRECT_URI);
if (redirect.hostname !== "localhost" && redirect.hostname !== "127.0.0.1") {
  console.log('Depois, rode: npm run tiktok:login -- "<URL completa para onde o TikTok redirecionou>"');
  process.exit(0);
}

const port = Number(redirect.port || 8585);
const server = createServer((req, res) => {
  const incoming = new URL(req.url ?? "/", env.TIKTOK_REDIRECT_URI);
  res.end("Pode fechar esta aba e voltar ao terminal.");
  server.close();
  finish(incoming, codeVerifier, state).then(
    () => process.exit(0),
    (error) => {
      console.error(error);
      process.exit(1);
    },
  );
});
server.listen(port, () => console.log(`Aguardando o callback em ${env.TIKTOK_REDIRECT_URI} ...`));
