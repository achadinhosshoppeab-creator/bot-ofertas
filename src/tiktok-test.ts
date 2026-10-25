/** Post de teste no TikTok (privado, só você vê): `npm run tiktok:test -- data/drafts/<data>/<id>/video.mp4` */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig } from "./config.js";
import { TikTokAuth, TikTokPublisher } from "./publishers/tiktok/index.js";

const file = process.argv[2];
if (!file) {
  throw new Error("Uso: npm run tiktok:test -- caminho/do/video.mp4");
}
const { env } = loadConfig();
const auth = new TikTokAuth({
  clientKey: env.TIKTOK_CLIENT_KEY,
  clientSecret: env.TIKTOK_CLIENT_SECRET,
  redirectUri: env.TIKTOK_REDIRECT_URI,
  tokensPath: resolve(env.TIKTOK_TOKENS_PATH),
});
const publisher = new TikTokPublisher(auth);
const info = await publisher.creatorInfo();
console.log(`Conta: @${info.creator_username ?? "?"}; privacidades: ${info.privacy_level_options.join(", ")}`);
const id = await publisher.publishVideo(readFileSync(resolve(file)), "Teste do bot Achadinhos (privado)", "SELF_ONLY");
console.log(`Publicado (privado). publish_id: ${id}`);
