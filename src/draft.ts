/**
 * Gera rascunhos de carrossel (TikTok/Instagram) das melhores ofertas e manda
 * para o admin no Telegram, para postar manualmente enquanto a API não é aprovada.
 * Também salva em data/drafts/estoque/<id>/ (slide1.jpg, slide2.jpg, legenda.txt, video.mp4).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildCarousel, fetchImage } from "./content/carousel.js";
import { pick, socialCaption } from "./content/caption.js";

/** Vozes aprovadas; intercaladas por produto. */
const VOICES = ["pt-BR-FranciscaNeural", "pt-BR-ThalitaMultilingualNeural"];
import type { TtsOptions } from "./content/video.js";
import { buildVideo3d } from "./content/video3d.js";
import { loadConfig } from "./config.js";
import { hasDraft, insertDraft, openDatabase, closeDatabase } from "./db.js";
import { TelegramClient } from "./publishers/telegram.js";
import { createSourceAndLinker, runOnce, type Candidate } from "./run.js";
import { categoryOf, hotScore } from "./site/publish.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const { env, filtros } = config;
  const db = openDatabase(resolve(env.DATABASE_PATH));
  const { createSource, linker } = createSourceAndLinker(config);
  const telegram = env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_ADMIN_CHAT_ID ? new TelegramClient(env.TELEGRAM_BOT_TOKEN) : undefined;
  // "python3" (comando no PATH) fica como está; ".venv/bin/python" vira caminho absoluto.
  const python = env.TTS_PYTHON.includes("/") ? resolve(env.TTS_PYTHON) : env.TTS_PYTHON;
  const ttsFor = (productId: string): TtsOptions | undefined =>
    env.TTS_ENGINE === "edge"
      ? { engine: "edge", python, voice: env.TTS_VOICE === "auto" ? pick(VOICES, productId, "voice") : env.TTS_VOICE, rate: env.TTS_RATE }
      : env.TTS_ENGINE === "kokoro" && env.TTS_MODEL_DIR
        ? { engine: "kokoro", modelDir: resolve(env.TTS_MODEL_DIR), python, speakerId: env.TTS_SPEAKER_ID }
        : undefined;

  try {
    const result = await runOnce({ db, source: createSource(), linker, filtros, dryRun: true, log: () => {} });
    const pending = result.approved.filter(
      (c) => c.offer.imageUrl && !hasDraft(db, { productId: c.offer.productId, source: c.offer.source }),
    );
    // Para redes sociais, prioriza o que tende a dar view: muito vendido, desconto alto e preço "impulso".
    const chosen = [...pending].sort((a, b) => hotScore(b.offer, b.evaluation.discountPercent) - hotScore(a.offer, a.evaluation.discountPercent)).slice(0, env.DRAFTS_PER_RUN);
    console.log(`[draft] ${result.approved.length} aprovadas, ${pending.length} sem rascunho; gerando ${chosen.length}.`);

    // Estoque: ainda não postado. `npm run tiktok:post` move para data/drafts/publicados/<data>/.
    for (const candidate of chosen) {
      const dir = resolve("data", "drafts", "estoque", candidate.offer.productId);
      await draft(candidate, dir, env.BRAND_NAME, env.TELEGRAM_CHANNEL_ID, categoryOf(candidate.offer.searchTerm, filtros.categories), telegram, env.TELEGRAM_ADMIN_CHAT_ID, ttsFor(candidate.offer.productId));
      insertDraft(db, { productId: candidate.offer.productId, source: candidate.offer.source, price: candidate.offer.price });
      console.log(`[draft] ${candidate.offer.title.slice(0, 60)} → ${dir}`);
    }
    if (!telegram) {
      console.log("[draft] TELEGRAM_BOT_TOKEN/ADMIN_CHAT_ID vazios: rascunhos só em data/drafts.");
    }
  } finally {
    closeDatabase(db);
  }
}

async function draft(
  candidate: Candidate,
  dir: string,
  brand: string,
  channelId: string,
  category: string | undefined,
  telegram: TelegramClient | undefined,
  adminChatId: string,
  tts: TtsOptions | undefined,
): Promise<void> {
  const input = {
    offer: candidate.offer,
    referencePrice: candidate.evaluation.referencePrice,
    discountPercent: candidate.evaluation.discountPercent,
    brand,
    ...(channelId.startsWith("@") ? { telegram: channelId.slice(1) } : {}),
    ...(category ? { category } : {}),
  };
  const slides = await buildCarousel(input);
  const caption = socialCaption(input);

  mkdirSync(dir, { recursive: true });
  slides.forEach((slide, index) => writeFileSync(resolve(dir, `slide${index + 1}.jpg`), slide));
  writeFileSync(resolve(dir, "legenda.txt"), `${caption}\n\nLink do produto: ${candidate.offer.url}\n`, "utf8");

  const videoPath = resolve(dir, "video.mp4");
  let video: Buffer | undefined;
  try {
    const image = await fetchImage(candidate.offer.imageUrl as string);
    await buildVideo3d({ ...input, referencePrice: candidate.evaluation.referencePrice }, image, videoPath, tts);
    video = readFileSync(videoPath);
  } catch (error) {
    console.warn(`[draft] vídeo falhou (segue só com as imagens): ${String(error)}`);
  }

  if (telegram) {
    if (video) {
      await telegram.sendVideo(adminChatId, video, caption);
    } else {
      await telegram.sendMediaGroup(adminChatId, slides, caption);
    }
    await telegram.sendMessage(adminChatId, `Link desse produto (para a DM):\n${candidate.offer.url}\n\nPasta: estoque/${candidate.offer.productId}`);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
