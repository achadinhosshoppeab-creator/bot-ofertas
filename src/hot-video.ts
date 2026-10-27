/**
 * Escolhe a oferta mais "quente" do momento, gera o vídeo 3D caprichado e manda no Telegram do admin
 * com legenda e link em mensagens separadas (para copiar e colar).
 *
 *   npm run hot -- [--max-price=80] [--voice=pt-BR-ThalitaMultilingualNeural] [--id=<itemId>]
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pick, socialCaption } from "./content/caption.js";
import { fetchImage } from "./content/carousel.js";
import { buildVideo3d } from "./content/video3d.js";
import type { TtsOptions } from "./content/video.js";
import { loadConfig } from "./config.js";
import { closeDatabase, hasDraft, insertDraft, openDatabase } from "./db.js";
import { TelegramClient } from "./publishers/telegram.js";
import { createSourceAndLinker, runOnce } from "./run.js";
import { hotScore } from "./site/publish.js";

const args = process.argv.slice(2);
const opt = (name: string, fallback: string) => args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1] ?? fallback;
const maxPrice = Number(opt("max-price", "80"));
const wantedId = opt("id", "");
const VOICES = ["pt-BR-FranciscaNeural", "pt-BR-ThalitaMultilingualNeural"];

const config = loadConfig();
const { env, filtros } = config;
const db = openDatabase(resolve(env.DATABASE_PATH));
const { createSource, linker } = createSourceAndLinker(config);
const telegram = env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_ADMIN_CHAT_ID ? new TelegramClient(env.TELEGRAM_BOT_TOKEN) : undefined;
const python = env.TTS_PYTHON.includes("/") ? resolve(env.TTS_PYTHON) : env.TTS_PYTHON;

try {
  const result = await runOnce({ db, source: createSource(), linker, filtros, dryRun: true, log: () => {} });
  const ranked = result.approved
    .filter((c) => c.offer.imageUrl && (wantedId ? c.offer.productId === wantedId : c.offer.price <= maxPrice && !hasDraft(db, { productId: c.offer.productId, source: c.offer.source })))
    .sort((a, b) => hotScore(b.offer, b.evaluation.discountPercent) - hotScore(a.offer, a.evaluation.discountPercent));
  const candidate = ranked[0];
  if (!candidate) {
    throw new Error("Nenhuma oferta elegível.");
  }
  const { offer, evaluation } = candidate;
  console.log(`[hot] ${offer.title.slice(0, 70)} · R$ ${offer.price} · -${Math.round(evaluation.discountPercent)}% · ${offer.salesCount ?? "?"} vendas`);

  const voice = opt("voice", env.TTS_VOICE === "auto" ? pick(VOICES, offer.productId, "voice") : env.TTS_VOICE);
  const tts: TtsOptions | undefined = env.TTS_ENGINE === "edge" ? { engine: "edge", python, voice, rate: env.TTS_RATE } : undefined;
  const telegramUser = env.TELEGRAM_CHANNEL_ID.startsWith("@") ? env.TELEGRAM_CHANNEL_ID.slice(1) : undefined;
  const input = {
    offer,
    referencePrice: evaluation.referencePrice,
    discountPercent: evaluation.discountPercent,
    brand: env.BRAND_NAME,
    ...(telegramUser ? { telegram: telegramUser } : {}),
  };

  const dir = resolve("data", "drafts", "estoque", `${offer.productId}-3d`);
  mkdirSync(dir, { recursive: true });
  const image = await fetchImage(offer.imageUrl as string);
  const videoPath = resolve(dir, "video.mp4");
  const seconds = await buildVideo3d(input, image, videoPath, tts);
  const caption = socialCaption(input);
  writeFileSync(resolve(dir, "legenda.txt"), `${caption}\n\nLink do produto: ${offer.url}\n`, "utf8");
  insertDraft(db, { productId: offer.productId, source: offer.source, price: offer.price });
  console.log(`[hot] vídeo de ${seconds}s em ${videoPath}`);

  if (telegram) {
    await telegram.sendVideo(env.TELEGRAM_ADMIN_CHAT_ID, readFileSync(videoPath), `🔥 Oferta quente: ${offer.title.slice(0, 80)}`);
    await telegram.sendMessage(env.TELEGRAM_ADMIN_CHAT_ID, caption);
    await telegram.sendMessage(env.TELEGRAM_ADMIN_CHAT_ID, offer.url);
    console.log("[hot] enviado no Telegram.");
  }
} finally {
  closeDatabase(db);
}
