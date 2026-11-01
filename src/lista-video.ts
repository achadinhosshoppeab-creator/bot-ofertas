/**
 * Vídeo lista ("5 achadinhos abaixo de R$ 30") com as ofertas mais quentes, de tipos diferentes,
 * e envio no Telegram do admin com legenda e a lista numerada de links (para responder os comentários).
 *
 *   npm run lista -- [--count=5] [--max-price=30] [--skip=calca,chinelo]
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { hashtags, pick } from "./content/caption.js";
import { fetchImage } from "./content/carousel.js";
import { buildListaVideo, type ListaItem } from "./content/video-lista.js";
import type { TtsOptions } from "./content/video.js";
import { loadConfig } from "./config.js";
import { closeDatabase, insertDraft, openDatabase } from "./db.js";
import { TelegramClient } from "./publishers/telegram.js";
import { createSourceAndLinker, runOnce } from "./run.js";
import { categoryOf, hotScore } from "./site/publish.js";

const args = process.argv.slice(2);
const opt = (name: string, fallback: string) =>
  args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1] ?? fallback;
const count = Math.max(3, Math.min(8, Number(opt("count", "5"))));
const maxPrice = Number(opt("max-price", "30"));
/** Qualidade mínima para entrar na lista: desconto e vendas de verdade. */
const minDiscount = Number(opt("min-discount", "30"));
const minSales = Number(opt("min-sales", "1000"));
/** --dry: só lista os candidatos (sem vídeo), para calibrar os filtros. */
const DRY = args.includes("--dry");
const skipWords = opt("skip", "")
  .split(",")
  .map((w) => w.trim().toLowerCase())
  .filter(Boolean);
const VOICES = ["pt-BR-FranciscaNeural", "pt-BR-AntonioNeural"];
const UNSAFE =
  /sutiã|sutia|calcinha|lingerie|cueca|sexy|bikini|biquíni|biquini|modelador|cinta|body\b/i;
/** Produto "commodity" que não segura atenção em vídeo (embalagem, insumo). */
const BORING =
  /\bsaco|sacola|saquinho|embalagem|fita isolante|fita crepe|lixo\b|papel toalha|guardanapo|fralda|absorvente|cavalo/i;

const slug = (t: string) =>
  t
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
const productWord = (title: string) =>
  slug(title)
    .split(/[^a-z]+/)
    .find(
      (w) => w.length >= 4 && !["kit", "promocao", "conjunto"].includes(w),
    ) ?? "";

/** Tipos de produto que já viraram vídeo (estoque + publicados). */
function recentProductWords(): Set<string> {
  const words = new Set<string>();
  for (const base of ["estoque", "publicados"]) {
    const root = resolve("data", "drafts", base);
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root, { withFileTypes: true }).filter(
      (e) => e.isDirectory() && e.name.startsWith("lista-"),
    )) {
      const d = resolve(root, entry.name);
      const leaves = [
        d,
        ...readdirSync(d, { withFileTypes: true })
          .filter((e) => e.isDirectory())
          .map((e) => resolve(d, e.name)),
      ];
      for (const leaf of leaves) {
        const legenda = resolve(leaf, "legenda.txt");
        if (!existsSync(legenda)) continue;
        const lines = readFileSync(legenda, "utf8").split("\n");
        // Vídeo de 1 produto: título na 1ª linha (após o emoji de abertura). Lista: linhas "N) Título · R$ ...".
        const first =
          /^.*?[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]\u{FE0F}?\s*(.+)$/u.exec(
            lines[0] ?? "",
          );
        if (first?.[1] && !/^\d+ achadinhos/i.test(lines[0] ?? ""))
          words.add(productWord(first[1]));
        for (const line of lines) {
          const m = /^\d+\)\s+(.+?)\s+·/.exec(line);
          if (m?.[1]) words.add(productWord(m[1]));
        }
      }
    }
  }
  words.delete("");
  return words;
}

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
    .filter(
      (c) =>
        c.offer.imageUrl &&
        c.offer.price <= maxPrice &&
        c.evaluation.discountPercent >= minDiscount &&
        (c.offer.salesCount ?? 0) >= minSales &&
        !UNSAFE.test(c.offer.title) &&
        !BORING.test(c.offer.title) &&
        !avoid.has(productWord(c.offer.title)),
    )
    .sort(
      (a, b) =>
        hotScore(b.offer, b.evaluation.discountPercent) -
        hotScore(a.offer, a.evaluation.discountPercent),
    );

  if (DRY) {
    const pool = result.approved
      .filter(
        (c) =>
          c.offer.imageUrl &&
          c.offer.price <= maxPrice &&
          !UNSAFE.test(c.offer.title) &&
          !BORING.test(c.offer.title) &&
          !avoid.has(productWord(c.offer.title)),
      )
      .sort(
        (a, b) =>
          hotScore(b.offer, b.evaluation.discountPercent) -
          hotScore(a.offer, a.evaluation.discountPercent),
      );
    for (const c of pool.slice(0, 25))
      console.log(
        `${c.offer.price.toFixed(2).padStart(6)} | -${Math.round(c.evaluation.discountPercent)}% | ${String(c.offer.salesCount ?? 0).padStart(5)} v | ${categoryOf(c.offer.searchTerm, filtros.categories) ?? "-"} | ${c.offer.title.slice(0, 55)}`,
      );
    console.log(
      `(${pool.length} candidatos até R$ ${maxPrice}; evitando: ${[...avoid].join(", ")})`,
    );
    process.exit(0);
  }
  // Variedade: um tipo de produto por item e no máximo 2 por categoria.
  const usedWords = new Set<string>();
  const usedCats = new Map<string, number>();
  const chosen: typeof ranked = [];
  for (const c of ranked) {
    const w = productWord(c.offer.title);
    const cat = categoryOf(c.offer.searchTerm, filtros.categories) ?? "outros";
    if (usedWords.has(w) || (usedCats.get(cat) ?? 0) >= 3) continue;
    usedWords.add(w);
    usedCats.set(cat, (usedCats.get(cat) ?? 0) + 1);
    chosen.push(c);
    if (chosen.length === count) break;
  }
  if (chosen.length < 3)
    throw new Error(
      `Só ${chosen.length} ofertas elegíveis abaixo de R$ ${maxPrice}.`,
    );

  const items: ListaItem[] = chosen.map((c) => ({
    offer: c.offer,
    referencePrice: c.evaluation.referencePrice,
    discountPercent: c.evaluation.discountPercent,
  }));
  items.forEach((it, i) =>
    console.log(
      `[lista] ${i + 1}) ${it.offer.title.slice(0, 60)} · R$ ${it.offer.price} · -${Math.round(it.discountPercent)}% · ${it.offer.salesCount ?? "?"} vendas`,
    ),
  );

  const seed = items.map((i) => i.offer.productId).join("-");
  const voice =
    env.TTS_VOICE === "auto" ? pick(VOICES, seed, "voice") : env.TTS_VOICE;
  const tts: TtsOptions | undefined =
    env.TTS_ENGINE === "edge"
      ? { engine: "edge", python, voice, rate: "+18%" }
      : undefined;
  const telegramUser = env.TELEGRAM_CHANNEL_ID.startsWith("@")
    ? env.TELEGRAM_CHANNEL_ID.slice(1)
    : undefined;

  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  const dir = resolve("data", "drafts", "estoque", `lista-${stamp}`);
  mkdirSync(dir, { recursive: true });
  const images = await Promise.all(
    items.map((it) => fetchImage(it.offer.imageUrl as string)),
  );
  const videoPath = resolve(dir, "video.mp4");
  const seconds = await buildListaVideo(
    {
      items,
      maxPrice,
      brand: env.BRAND_NAME,
      ...(telegramUser ? { telegram: telegramUser } : {}),
    },
    images,
    videoPath,
    tts,
  );

  // Legenda: gancho + pedido de comentário; hashtags das categorias dos itens (máx. 5).
  const cats = [
    ...new Set(
      items
        .map((it) => categoryOf(it.offer.searchTerm, filtros.categories))
        .filter(Boolean),
    ),
  ] as string[];
  const tagSet = new Set<string>();
  for (const cat of cats)
    for (const tag of hashtags({
      offer: { ...items[0]!.offer, title: "" },
      category: cat,
    }).slice(0, 2))
      tagSet.add(tag);
  for (const tag of ["#dicadecompra", "#comprinhas", "#precobaixo"])
    tagSet.add(tag);
  const tags = [...tagSet].slice(0, 5).join(" ");
  const caption = [
    `${items.length} achadinhos abaixo de R$ ${maxPrice} que valem MUITO a pena 🔥`,
    "Comenta o NÚMERO do que você quer que eu te mando o link 👇",
    "Salva pra não perder!",
    "",
    tags,
  ].join("\n");
  const links = items
    .map(
      (it, i) =>
        `${i + 1}) ${it.offer.title.slice(0, 50)} · R$ ${it.offer.price.toFixed(2).replace(".", ",")}\n${it.offer.url}`,
    )
    .join("\n\n");
  writeFileSync(
    resolve(dir, "legenda.txt"),
    `${caption}\n\nLinks (responder nos comentários):\n${links}\n`,
    "utf8",
  );
  for (const it of items)
    insertDraft(db, {
      productId: it.offer.productId,
      source: it.offer.source,
      price: it.offer.price,
    });
  console.log(`[lista] vídeo de ${seconds.toFixed(1)}s em ${videoPath}`);

  if (telegram) {
    await telegram.sendVideo(
      env.TELEGRAM_ADMIN_CHAT_ID,
      readFileSync(videoPath),
      `🔥 Lista: ${items.length} achadinhos abaixo de R$ ${maxPrice}`,
    );
    await telegram.sendMessage(env.TELEGRAM_ADMIN_CHAT_ID, caption);
    await telegram.sendMessage(
      env.TELEGRAM_ADMIN_CHAT_ID,
      `Links numerados (para responder quem comentar):\n\n${links}`,
    );
    console.log("[lista] enviado no Telegram.");
  }
} finally {
  closeDatabase(db);
}
