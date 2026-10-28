/**
 * Escolhe a oferta mais "quente" do momento, gera o vídeo 3D caprichado e manda no Telegram do admin
 * com legenda e link em mensagens separadas (para copiar e colar).
 *
 *   npm run hot -- [--count=3] [--max-price=80] [--voice=pt-BR-FranciscaNeural] [--id=<itemId>]
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { pick, socialCaption } from "./content/caption.js";
import { fetchImage } from "./content/carousel.js";
import { buildVideo3d } from "./content/video3d.js";
import type { TtsOptions } from "./content/video.js";
import { loadConfig } from "./config.js";
import { closeDatabase, hasDraft, insertDraft, openDatabase } from "./db.js";
import { TelegramClient } from "./publishers/telegram.js";
import { createSourceAndLinker, runOnce } from "./run.js";
import { categoryOf, hotScore } from "./site/publish.js";

const args = process.argv.slice(2);
const opt = (name: string, fallback: string) =>
  args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1] ?? fallback;
const maxPrice = Number(opt("max-price", "80"));
const wantedId = opt("id", "");
const count = wantedId ? 1 : Math.max(1, Number(opt("count", "1")));
/** Palavras para pular (ex.: --skip=calca,pantalona) além das que já viraram vídeo recentemente. */
const skipWords = opt("skip", "")
  .split(",")
  .map((w) => w.trim().toLowerCase())
  .filter(Boolean);

const slug = (t: string) =>
  t
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
/** Primeira palavra "de produto" do título (calca, sandalia, squishy...). */
function productWord(title: string): string {
  return (
    slug(title)
      .split(/[^a-z]+/)
      .find(
        (w) => w.length >= 4 && !["kit", "promocao", "conjunto"].includes(w),
      ) ?? ""
  );
}
/** Produtos que já viraram vídeo (estoque + publicados): evita mandar o mesmo tipo de novo. */
function recentProductWords(): Set<string> {
  const words = new Set<string>();
  for (const base of ["estoque", "publicados"]) {
    const root = resolve("data", "drafts", base);
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      const dirs = entry.isDirectory() ? [resolve(root, entry.name)] : [];
      for (const d of dirs) {
        const sub = readdirSync(d, { withFileTypes: true })
          .filter((e) => e.isDirectory())
          .map((e) => resolve(d, e.name));
        for (const leaf of [d, ...sub]) {
          const legenda = resolve(leaf, "legenda.txt");
          if (!existsSync(legenda)) continue;
          const first = readFileSync(legenda, "utf8").split("\n")[0] ?? "";
          const title = first.replace(
            /^.*?[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]\u{FE0F}?\s*/u,
            "",
          );
          const w = productWord(title);
          if (w) words.add(w);
        }
      }
    }
  }
  return words;
}
const VOICES = ["pt-BR-FranciscaNeural", "pt-BR-ThalitaMultilingualNeural"];
/** Produtos que as redes costumam travar (imagem de corpo/roupa íntima); fora da seleção automática. */
const UNSAFE =
  /sutiã|sutia|calcinha|lingerie|cueca|sexy|bikini|biquíni|biquini|modelador|cinta|body\b/i;

const config = loadConfig();
const { env, filtros } = config;
const db = openDatabase(resolve(env.DATABASE_PATH));
const { createSource, linker } = createSourceAndLinker(config);
const telegram =
  env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_ADMIN_CHAT_ID
    ? new TelegramClient(env.TELEGRAM_BOT_TOKEN)
    : undefined;
const python = env.TTS_PYTHON.includes("/")
  ? resolve(env.TTS_PYTHON)
  : env.TTS_PYTHON;

try {
  const result = await runOnce({
    db,
    source: createSource(),
    linker,
    filtros,
    dryRun: true,
    log: () => {},
  });
  const avoid = new Set([...recentProductWords(), ...skipWords]);
  const ranked = result.approved
    .filter((c) => wantedId || !avoid.has(productWord(c.offer.title)))
    .filter(
      (c) =>
        c.offer.imageUrl &&
        (wantedId
          ? c.offer.productId === wantedId
          : c.offer.price <= maxPrice &&
            !UNSAFE.test(c.offer.title) &&
            !hasDraft(db, {
              productId: c.offer.productId,
              source: c.offer.source,
            })),
    )
    .sort(
      (a, b) =>
        hotScore(b.offer, b.evaluation.discountPercent) -
        hotScore(a.offer, a.evaluation.discountPercent),
    );
  if (ranked.length === 0) {
    throw new Error("Nenhuma oferta elegível.");
  }
  for (const { offer, evaluation } of ranked.slice(0, count)) {
    console.log(
      `[hot] ${offer.title.slice(0, 70)} · R$ ${offer.price} · -${Math.round(evaluation.discountPercent)}% · ${offer.salesCount ?? "?"} vendas`,
    );

    const voice = opt(
      "voice",
      env.TTS_VOICE === "auto"
        ? pick(VOICES, offer.productId, "voice")
        : env.TTS_VOICE,
    );
    const tts: TtsOptions | undefined =
      env.TTS_ENGINE === "edge"
        ? { engine: "edge", python, voice, rate: env.TTS_RATE }
        : undefined;
    const telegramUser = env.TELEGRAM_CHANNEL_ID.startsWith("@")
      ? env.TELEGRAM_CHANNEL_ID.slice(1)
      : undefined;
    const category = categoryOf(offer.searchTerm, filtros.categories);
    const input = {
      offer,
      referencePrice: evaluation.referencePrice,
      discountPercent: evaluation.discountPercent,
      brand: env.BRAND_NAME,
      ...(telegramUser ? { telegram: telegramUser } : {}),
      ...(category ? { category } : {}),
    };

    const dir = resolve("data", "drafts", "estoque", `${offer.productId}-3d`);
    mkdirSync(dir, { recursive: true });
    const image = await fetchImage(offer.imageUrl as string);
    const videoPath = resolve(dir, "video.mp4");
    const seconds = await buildVideo3d(input, image, videoPath, tts);
    const caption = socialCaption(input);
    writeFileSync(
      resolve(dir, "legenda.txt"),
      `${caption}\n\nLink do produto: ${offer.url}\n`,
      "utf8",
    );
    insertDraft(db, {
      productId: offer.productId,
      source: offer.source,
      price: offer.price,
    });
    console.log(`[hot] vídeo de ${seconds}s em ${videoPath}`);

    if (telegram) {
      await telegram.sendVideo(
        env.TELEGRAM_ADMIN_CHAT_ID,
        readFileSync(videoPath),
        `🔥 Oferta quente: ${offer.title.slice(0, 80)}`,
      );
      await telegram.sendMessage(env.TELEGRAM_ADMIN_CHAT_ID, caption);
      await telegram.sendMessage(env.TELEGRAM_ADMIN_CHAT_ID, offer.url);
      console.log("[hot] enviado no Telegram.");
    }
  }
} finally {
  closeDatabase(db);
}
