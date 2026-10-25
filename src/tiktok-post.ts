/**
 * Publica rascunhos no TikTok com intervalo entre eles.
 *   npm run tiktok:post -- --gap=20 --privacy=FOLLOWER_OF_CREATOR data/drafts/<data>/<id> [outra pasta...]
 * Cada pasta precisa ter video.mp4 e legenda.txt (primeira linha em branco separa legenda do link).
 */
import { appendFileSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import { basename } from "node:path";
import { resolve } from "node:path";
import { loadConfig } from "./config.js";
import { TikTokAuth, TikTokPublisher, type PrivacyLevel } from "./publishers/tiktok/index.js";

const args = process.argv.slice(2);
const opt = (name: string, fallback: string) => args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1] ?? fallback;
const dirs = args.filter((a) => !a.startsWith("--"));
const gapMinutes = Number(opt("gap", "20"));
const privacy = opt("privacy", "SELF_ONLY") as PrivacyLevel;
if (dirs.length === 0) {
  throw new Error("Informe ao menos uma pasta de rascunho.");
}

const { env } = loadConfig();
const auth = new TikTokAuth({
  clientKey: env.TIKTOK_CLIENT_KEY,
  clientSecret: env.TIKTOK_CLIENT_SECRET,
  redirectUri: env.TIKTOK_REDIRECT_URI,
  tokensPath: resolve(env.TIKTOK_TOKENS_PATH),
});
const publisher = new TikTokPublisher(auth);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

for (const [index, dir] of dirs.entries()) {
  const video = readFileSync(resolve(dir, "video.mp4"));
  const caption = readFileSync(resolve(dir, "legenda.txt"), "utf8").split("\n\nLink")[0]?.trim() ?? "";
  const stamp = () => new Date().toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
  const id = await publisher.publishVideo(video, caption, privacy);
  console.log(`[tiktok] ${stamp()} publicado (${privacy}) ${dir} → ${id}`);
  // Separa o que já foi: estoque/<id> → publicados/<data>/<id>
  const day = new Date().toISOString().slice(0, 10);
  const doneDir = resolve("data", "drafts", "publicados", day);
  mkdirSync(doneDir, { recursive: true });
  renameSync(resolve(dir), resolve(doneDir, basename(dir)));
  appendFileSync(resolve("data", "drafts", "publicados", "log.txt"), `${new Date().toISOString()}\t${basename(dir)}\t${privacy}\t${id}\n`);
  if (index < dirs.length - 1) {
    console.log(`[tiktok] próximo em ${gapMinutes} min`);
    await sleep(gapMinutes * 60_000);
  }
}
