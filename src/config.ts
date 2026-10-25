import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadDotenv } from "dotenv";
import { z } from "zod";

loadDotenv();

const booleanFromEnv = z
  .union([z.boolean(), z.string()])
  .transform((value) => {
    if (typeof value === "boolean") {
      return value;
    }
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) {
      return true;
    }
    if (["0", "false", "no", "off", ""].includes(normalized)) {
      return false;
    }
    throw new Error(`Valor booleano inválido: ${value}`);
  });

export const envSchema = z.object({
  /** De onde vêm as ofertas. */
  OFFER_SOURCE: z.enum(["shopee", "mercadolivre"]).default("shopee"),
  SHOPEE_APP_ID: z.string().default(""),
  SHOPEE_SECRET: z.string().default(""),
  TELEGRAM_BOT_TOKEN: z.string().default(""),
  TELEGRAM_CHANNEL_ID: z.string().default(""),
  TELEGRAM_ADMIN_CHAT_ID: z.string().default(""),
  ML_CLIENT_ID: z.string().default(""),
  ML_CLIENT_SECRET: z.string().default(""),
  ML_REFRESH_TOKEN: z.string().default(""),
  ML_TOKENS_PATH: z.string().default("data/ml-tokens.json"),
  /** `matt_tool` do link de afiliado. */
  ML_AFFILIATE_ID: z.string().default(""),
  /** `matt_word` do link de afiliado (etiqueta). */
  ML_AFFILIATE_TAG: z.string().default(""),
  /** Nome da marca usado nas imagens e legendas. */
  BRAND_NAME: z.string().default("Achadinhos"),
  /** Quantos rascunhos de carrossel gerar por execução de `npm run draft`. */
  DRAFTS_PER_RUN: z.coerce.number().int().positive().default(3),
  /** Pasta do modelo Kokoro para narração; vazio = vídeo sem voz. */
  /** "edge" (vozes neurais pt-BR, precisa de `pip install edge-tts` no venv), "kokoro" ou "off". */
  TTS_ENGINE: z.enum(["edge", "kokoro", "off"]).default("edge"),
  /** Uma voz fixa, ou "auto" para intercalar entre as vozes aprovadas (estável por produto). */
  /** Uma voz fixa, ou "auto" para intercalar entre as vozes aprovadas (estável por produto). */
  TTS_VOICE: z.string().default("auto"),
  TTS_RATE: z.string().default("+8%"),
  TTS_MODEL_DIR: z.string().default(""),
  TTS_PYTHON: z.string().default(".venv/bin/python"),
  TTS_SPEAKER_ID: z.coerce.number().int().nonnegative().default(43),
  TIKTOK_CLIENT_KEY: z.string().default(""),
  TIKTOK_CLIENT_SECRET: z.string().default(""),
  TIKTOK_REDIRECT_URI: z.string().default("http://localhost:8585/callback"),
  TIKTOK_TOKENS_PATH: z.string().default("data/tiktok-tokens.json"),
  /** Clone local do site (GitHub Pages). Vazio = não atualiza o site. */
  SITE_DIR: z.string().default(""),
  SITE_URL: z.string().default(""),
  SITE_MAX_OFFERS: z.coerce.number().int().positive().default(200),
  /** Faz commit+push do offers.json (independe de DRY_RUN, o site não é um "post"). */
  SITE_PUSH: booleanFromEnv.default(true),
  DRY_RUN: booleanFromEnv.default(true),
  DATABASE_PATH: z.string().default("data/bot.db"),
  /** Expressão cron do agendador (horário de Brasília). */
  SCHEDULE_CRON: z.string().default("*/15 8-23 * * *"),
  /** Quando gerar os rascunhos diários para TikTok (vazio = não gera). */
  DRAFTS_CRON: z.string().default("30 7 * * *"),
});

export const filtrosSchema = z.object({
  searchTerms: z.array(z.string().min(1)).min(1),
  /** IDs de categoria do ML cujos mais vendidos entram na coleta. */
  highlightCategoryIds: z.array(z.string().min(1)).default([]),
  /** Grupo exibido no site → termos de busca que pertencem a ele. */
  categories: z.record(z.string(), z.array(z.string())).default({}),
  maxProductsPerTerm: z.number().int().positive().max(50).default(15),
  blockedWords: z.array(z.string().min(1)).default([]),
  minDiscountPercentWithHistory: z.number().min(0).max(100),
  minDiscountPercentWithoutHistory: z.number().min(0).max(100),
  /** Acima disso o "desconto da loja" é considerado inflado/suspeito. */
  maxStoreDiscountPercent: z.number().min(0).max(100).default(80),
  priceHistoryDays: z.number().int().positive(),
  /** Histórico só conta como "com histórico" se cobrir pelo menos esse número de dias. */
  minHistoryDays: z.number().int().nonnegative().default(3),
  minPriceBrl: z.number().positive(),
  /** Só vale para fontes que informam nota/vendas (Shopee). */
  minRating: z.number().min(0).max(5).default(4.5),
  minSales: z.number().int().nonnegative().default(50),
  /** Comissão mínima de afiliado (fração, ex. 0.07 = 7%). Só vale quando a fonte informa. */
  minCommissionRate: z.number().min(0).max(1).default(0),
  /** Peso da comissão na ordenação (0 = só desconto, 1 = só comissão). */
  commissionWeight: z.number().min(0).max(1).default(0.5),
  requireOfficialOrHighReputation: z.boolean(),
  republishCooldownDays: z.number().int().positive(),
  republishExtraDropPercent: z.number().min(0).max(100),
  maxPostsPerDay: z.number().int().positive(),
  minIntervalMinutesBetweenPosts: z.number().int().positive(),
  /** Intervalo é sorteado entre min e max a cada post (max = min desliga o sorteio). */
  maxIntervalMinutesBetweenPosts: z.number().int().positive().optional(),
});

export type EnvConfig = z.infer<typeof envSchema>;
export type FiltrosConfig = z.infer<typeof filtrosSchema>;

export type AppConfig = {
  env: EnvConfig;
  filtros: FiltrosConfig;
  filtrosPath: string;
};

function loadFiltros(filtrosPath: string): FiltrosConfig {
  const raw = readFileSync(filtrosPath, "utf8");
  const json: unknown = JSON.parse(raw);
  return filtrosSchema.parse(json);
}

export function loadConfig(options?: {
  cwd?: string;
  filtrosPath?: string;
  env?: NodeJS.ProcessEnv;
}): AppConfig {
  const cwd = options?.cwd ?? process.cwd();
  const filtrosPath =
    options?.filtrosPath ?? resolve(cwd, "config", "filtros.json");
  const env = envSchema.parse(options?.env ?? process.env);
  const filtros = loadFiltros(filtrosPath);

  return { env, filtros, filtrosPath };
}

/** Lista o que falta no .env para publicar de verdade (DRY_RUN=false). */
export function missingLiveSettings(env: EnvConfig): string[] {
  const required: Array<keyof EnvConfig> =
    env.OFFER_SOURCE === "shopee"
      ? ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHANNEL_ID", "SHOPEE_APP_ID", "SHOPEE_SECRET"]
      : ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHANNEL_ID", "ML_AFFILIATE_ID"];
  return required.filter((key) => !env[key]);
}

let cached: AppConfig | undefined;

/** Carrega e memoiza a config do processo (cwd atual). */
export function getConfig(): AppConfig {
  if (!cached) {
    cached = loadConfig();
  }
  return cached;
}

/** Útil em testes para limpar o cache. */
export function resetConfigCache(): void {
  cached = undefined;
}
