import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { MercadoLivreAffiliateLinker } from "./affiliate/mercadolivre.js";
import { PassthroughLinker } from "./affiliate/passthrough.js";
import type { AffiliateLinker } from "./affiliate/types.js";
import { loadConfig, missingLiveSettings, type AppConfig, type FiltrosConfig } from "./config.js";
import {
  closeDatabase,
  countPublishedSince,
  getLastPublishedAt,
  getPriceHistoryLastDays,
  getPublished,
  insertPriceHistory,
  openDatabase,
  upsertPublished,
  type Db,
  markOffersSeen,
} from "./db.js";
import { canPostNow, canRepublish, nextIntervalMinutes, startOfDayBrt } from "./pipeline/dedupe.js";
import { rankScore } from "./pipeline/rank.js";
import { evaluateOffer, normalize, type Evaluation } from "./pipeline/filter.js";
import { escapeHtml, formatMessage } from "./publishers/format.js";
import { TelegramAlerter, TelegramClient, TelegramPublisher } from "./publishers/telegram.js";
import type { Publisher } from "./publishers/types.js";
import { publishSite } from "./site/publish.js";
import { MercadoLivreSource, MlAuth, MlClient } from "./sources/mercadolivre/index.js";
import { ShopeeClient, ShopeeSource } from "./sources/shopee/index.js";
import type { Offer, OfferSource } from "./sources/types.js";

export type Candidate = {
  offer: Offer;
  evaluation: Extract<Evaluation, { accepted: true }>;
};

export type RunDeps = {
  db: Db;
  source: OfferSource;
  linker: AffiliateLinker;
  /** Obrigatório fora do dry-run. */
  publisher?: Publisher;
  filtros: FiltrosConfig;
  dryRun: boolean;
  /** false = só coleta/filtra (quem publica é o publishTick do app). */
  publishEnabled?: boolean;
  now?: () => Date;
  log?: (message: string) => void;
};

export type RunResult = {
  fetched: number;
  rejected: Record<string, number>;
  candidates: Candidate[];
  published: Array<Candidate & { messageId: string }>;
};

/** Uma execução: coleta → histórico → filtro → dedupe → publica (no máximo 1 post). */
export async function runOnce(deps: RunDeps): Promise<RunResult> {
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? console.log;
  const { db, filtros } = deps;

  const fetched = await deps.source.search(filtros.searchTerms);
  const offers = [...new Map(fetched.map((offer) => [offer.productId, offer])).values()];
  log(`[run] ${offers.length} produtos coletados de ${deps.source.name}`);

  const rejected: Record<string, number> = {};
  const candidates: Candidate[] = [];
  const evaluateAll = db.transaction(() => {
    for (const offer of offers) {
      const history = getPriceHistoryLastDays(db, {
        productId: offer.productId,
        source: offer.source,
        days: filtros.priceHistoryDays,
        now: offer.fetchedAt,
      });
      const evaluation = evaluateOffer(offer, history, filtros);
      insertPriceHistory(db, {
        productId: offer.productId,
        source: offer.source,
        price: offer.price,
        fetchedAt: offer.fetchedAt,
      });

      if (!evaluation.accepted) {
        const key = evaluation.reason.replace(/[\d.,]+%/g, "N%");
        rejected[key] = (rejected[key] ?? 0) + 1;
        continue;
      }
      const previous = getPublished(db, { productId: offer.productId, source: offer.source });
      if (!canRepublish(offer.price, previous, filtros, now())) {
        rejected["já publicado recentemente"] = (rejected["já publicado recentemente"] ?? 0) + 1;
        continue;
      }
      candidates.push({ offer, evaluation });
    }
  });
  evaluateAll();

  candidates.sort((a, b) => rankScore(b, filtros.commissionWeight) - rankScore(a, filtros.commissionWeight));
  // O mesmo produto pode vir de lojas diferentes com ids diferentes: fica só o melhor ranqueado.
  const seenTitles = new Set<string>();
  const unique = candidates.filter(({ offer }) => {
    const title = normalize(offer.title).replace(/\s+/g, " ").trim();
    if (seenTitles.has(title)) {
      return false;
    }
    seenTitles.add(title);
    return true;
  });
  candidates.splice(0, candidates.length, ...unique);
  log(`[run] ${candidates.length} ofertas aprovadas; rejeitadas: ${JSON.stringify(rejected)}`);

  const result: RunResult = { fetched: offers.length, rejected, candidates, published: [] };

  if (deps.dryRun) {
    for (const candidate of candidates.slice(0, 3)) {
      const link = await deps.linker.buildLink(candidate.offer);
      log(`\n${formatMessage(messageInput(candidate, link))}\n---`);
    }
    log(`[run] DRY_RUN: nada foi publicado (${candidates.length} aprovadas; mostrando até 3).`);
    return result;
  }

  if (deps.publishEnabled === false) {
    return result;
  }
  if (!deps.publisher) {
    throw new Error("Publisher não configurado fora do dry-run.");
  }

  const state = {
    postsToday: countPublishedSince(db, startOfDayBrt(now())),
    lastPublishedAt: getLastPublishedAt(db),
  };
  const best = candidates[0];
  if (!best) {
    return result;
  }
  if (!canPostNow(state, filtros, now())) {
    log(
      state.postsToday >= filtros.maxPostsPerDay
        ? `[run] limite diário atingido (${state.postsToday}/${filtros.maxPostsPerDay}); publico amanhã.`
        : `[run] último post há menos de ${filtros.minIntervalMinutesBetweenPosts} min (hoje: ${state.postsToday}); publico na próxima execução.`,
    );
    return result;
  }

  const messageId = await publishCandidate({ db, linker: deps.linker, publisher: deps.publisher, now }, best);
  result.published.push({ ...best, messageId });
  log(`[run] publicado: ${best.offer.title} (msg ${messageId})`);
  return result;
}

/** Publica um candidato e registra em `published`. */
export async function publishCandidate(
  deps: { db: Db; linker: AffiliateLinker; publisher: Publisher; now?: () => Date },
  candidate: Candidate,
): Promise<string> {
  const now = deps.now ?? (() => new Date());
  const link = await deps.linker.buildLink(candidate.offer);
  const messageId = await deps.publisher.publish({
    text: formatMessage(messageInput(candidate, link)),
    link,
    ...(candidate.offer.imageUrl ? { imageUrl: candidate.offer.imageUrl } : {}),
  });
  upsertPublished(deps.db, {
    productId: candidate.offer.productId,
    source: candidate.offer.source,
    price: candidate.offer.price,
    publishedAt: now(),
    messageId,
  });
  return messageId;
}

function messageInput(candidate: Candidate, link: string) {
  return {
    offer: candidate.offer,
    referencePrice: candidate.evaluation.referencePrice,
    discountPercent: candidate.evaluation.discountPercent,
    ...(candidate.evaluation.lowestInDays !== undefined
      ? { lowestInDays: candidate.evaluation.lowestInDays }
      : {}),
    link,
  };
}

/** Monta as dependências reais a partir da config. */
export function createApp(config: AppConfig) {
  const { env, filtros } = config;
  const telegram = env.TELEGRAM_BOT_TOKEN ? new TelegramClient(env.TELEGRAM_BOT_TOKEN) : undefined;
  const alerter = new TelegramAlerter(telegram, env.TELEGRAM_ADMIN_CHAT_ID);
  const db = openDatabase(resolve(env.DATABASE_PATH));
  const { createSource, linker } = createSourceAndLinker(config);
  const publisher =
    telegram && env.TELEGRAM_CHANNEL_ID ? new TelegramPublisher(telegram, env.TELEGRAM_CHANNEL_ID) : undefined;

  let running = false;
  /** Fila de candidatos da última coleta; o publishTick consome daqui. */
  let pool: Candidate[] = [];
  let intervalMinutes = nextIntervalMinutes(filtros);
  /** Posts já feitos no canal hoje (lido do banco: sobrevive a reinícios do processo). */
  const postsToday = (now: Date) => countPublishedSince(db, startOfDayBrt(now));

  /** Resumo de cada rodada para o admin (sempre, mesmo com 0 novas). */
  async function report(text: string): Promise<void> {
    console.log(text.replace(/\n/g, " | "));
    if (!telegram || !env.TELEGRAM_ADMIN_CHAT_ID) {
      return;
    }
    try {
      await telegram.sendMessage(env.TELEGRAM_ADMIN_CHAT_ID, escapeHtml(text));
    } catch (error) {
      console.error(`[report] falhou: ${String(error)}`);
    }
  }

  /** Executa uma vez; erros viram alerta e não derrubam o processo. */
  async function run(): Promise<RunResult | undefined> {
    if (running) {
      console.warn("[run] execução anterior ainda em andamento; pulando.");
      return undefined;
    }
    running = true;
    try {
      const result = await runOnce({
        db,
        // Fonte nova a cada execução para não reaproveitar cache de vendedores antigo.
        source: createSource(),
        linker,
        ...(publisher ? { publisher } : {}),
        filtros,
        dryRun: env.DRY_RUN,
        publishEnabled: false,
      });
      pool = result.candidates;
      let site = "desligado";
      if (env.SITE_DIR) {
        try {
          const outcome = await publishSite(resolve(env.SITE_DIR), result.candidates, {
            maxOffers: env.SITE_MAX_OFFERS,
            push: env.SITE_PUSH,
            categories: filtros.categories,
            ...(env.SITE_URL ? { siteUrl: env.SITE_URL } : {}),
          });
          site = outcome.changed ? `atualizado (${outcome.count})` : `sem mudanças (${outcome.count})`;
        } catch (error) {
          site = "falhou";
          await alerter.alert(`Falha ao publicar o site: ${String(error)}`);
        }
      }
      const fresh = markOffersSeen(db, result.candidates.map((c) => c.offer));
      await report(
        [
          `✅ Rotina ok ${new Date().toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" })}`,
          `${result.fetched} produtos · ${result.candidates.length} aprovadas · ${fresh} novas`,
          `site: ${site}`,
          env.DRY_RUN
            ? "canal: desligado (DRY_RUN)"
            : `canal: ${postsToday(new Date())} post${postsToday(new Date()) === 1 ? "" : "s"} hoje · ${pool.length} na fila`,
        ].join("\n"),
      );
      return result;
    } catch (error) {
      await alerter.alert(`Execução falhou: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
      return undefined;
    } finally {
      running = false;
    }
  }

  /**
   * Roda a cada minuto: publica o próximo da fila quando o intervalo sorteado
   * (entre min e max minutos) desde o último post já passou.
   */
  async function publishTick(): Promise<void> {
    if (env.DRY_RUN || !publisher || pool.length === 0) {
      return;
    }
    const now = new Date();
    const state = { postsToday: countPublishedSince(db, startOfDayBrt(now)), lastPublishedAt: getLastPublishedAt(db) };
    if (!canPostNow(state, { ...filtros, minIntervalMinutesBetweenPosts: intervalMinutes }, now)) {
      return;
    }
    const index = pool.findIndex((c) => canRepublish(c.offer.price, getPublished(db, { productId: c.offer.productId, source: c.offer.source }), filtros, now));
    if (index < 0) {
      pool = [];
      return;
    }
    const [candidate] = pool.splice(index, 1) as [Candidate];
    try {
      const messageId = await publishCandidate({ db, linker, publisher }, candidate);
      intervalMinutes = nextIntervalMinutes(filtros);
      console.log(`[canal] publicado: ${candidate.offer.title.slice(0, 60)} (msg ${messageId}); próximo em ~${intervalMinutes} min`);
    } catch (error) {
      await alerter.alert(`Falha ao publicar no canal: ${String(error)}`);
    }
  }

  return { run, publishTick, alerter, close: () => closeDatabase(db) };
}

/** Fonte de ofertas + gerador de link conforme OFFER_SOURCE. */
export function createSourceAndLinker(config: AppConfig): { createSource: () => OfferSource; linker: AffiliateLinker } {
  return config.env.OFFER_SOURCE === "shopee" ? shopeeSetup(config) : mercadoLivreSetup(config);
}

function shopeeSetup({ env, filtros }: AppConfig) {
  const client = new ShopeeClient(env.SHOPEE_APP_ID, env.SHOPEE_SECRET);
  return {
    createSource: (): OfferSource => new ShopeeSource(client, { maxProductsPerTerm: filtros.maxProductsPerTerm }),
    linker: new PassthroughLinker(),
  };
}

/**
 * Atenção: o programa de afiliados do ML não tem API e proíbe editar links;
 * o linker abaixo monta o link sozinho, então só use em dry-run.
 */
function mercadoLivreSetup({ env, filtros }: AppConfig) {
  const auth = new MlAuth({
    clientId: env.ML_CLIENT_ID,
    clientSecret: env.ML_CLIENT_SECRET,
    initialRefreshToken: env.ML_REFRESH_TOKEN,
    tokensPath: resolve(env.ML_TOKENS_PATH),
  });
  const client = new MlClient(auth);
  return {
    createSource: (): OfferSource =>
      new MercadoLivreSource(client, {
        highlightCategoryIds: filtros.highlightCategoryIds,
        maxProductsPerTerm: filtros.maxProductsPerTerm,
      }),
    linker: new MercadoLivreAffiliateLinker(env.ML_AFFILIATE_ID, env.ML_AFFILIATE_TAG),
  };
}

export function assertLiveReady(config: AppConfig): void {
  if (config.env.DRY_RUN) {
    return;
  }
  if (config.env.OFFER_SOURCE === "mercadolivre") {
    throw new Error(
      "Publicação automática com Mercado Livre desativada: o programa de afiliados exige links gerados no portal.",
    );
  }
  const missing = missingLiveSettings(config.env);
  if (missing.length > 0) {
    throw new Error(`DRY_RUN=false exige no .env: ${missing.join(", ")}`);
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  assertLiveReady(config);
  const app = createApp(config);
  const result = await app.run();
  app.close();
  if (!result) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
