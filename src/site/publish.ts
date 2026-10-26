import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Candidate } from "../run.js";

const run = promisify(execFile);

export type SiteOffer = {
  id: string;
  title: string;
  price: number;
  originalPrice?: number;
  discountPercent: number;
  imageUrl?: string;
  url: string;
  hasVariantPrices?: boolean;
  rating?: number;
  salesCount?: number;
  /** Loja oficial (Shopee Mall / loja oficial do ML). */
  official?: boolean;
  seller?: string;
  /** Grupo do site (ex.: "Beleza"), derivado do termo de busca. */
  category?: string;
  /** Destaque "pegando fogo": top N por vendas × desconto. */
  hot?: boolean;
};

export const HOT_COUNT = 8;

/** Potencial de atenção: muito vendido, desconto alto e preço de impulso. */
export function hotScore(offer: { salesCount?: number; price: number }, discountPercent: number): number {
  const sales = Math.log10((offer.salesCount ?? 0) + 1);
  const priceFactor = offer.price <= 60 ? 1 : offer.price <= 120 ? 0.8 : 0.6;
  return sales * discountPercent * priceFactor;
}

export type CategoryMap = Record<string, string[]>;

function categoryOf(
  term: string | undefined,
  categories: CategoryMap,
): string | undefined {
  if (!term) {
    return undefined;
  }
  return Object.entries(categories).find(([, terms]) =>
    terms.includes(term),
  )?.[0];
}

export type SiteData = { updatedAt: string; offers: SiteOffer[] };

export function toSiteData(
  candidates: readonly Candidate[],
  max: number,
  now = new Date(),
  categories: CategoryMap = {},
): SiteData {
  const shown = candidates.slice(0, max);
  const hotIds = new Set(
    [...shown]
      .sort((a, b) => hotScore(b.offer, b.evaluation.discountPercent) - hotScore(a.offer, a.evaluation.discountPercent))
      .slice(0, HOT_COUNT)
      .map((c) => c.offer.productId),
  );
  return {
    updatedAt: now.toISOString(),
    offers: shown.map(({ offer, evaluation }) => {
      const category = categoryOf(offer.searchTerm, categories);
      return {
        id: offer.productId,
        title: offer.title,
        price: offer.price,
        ...(evaluation.referencePrice > offer.price
          ? { originalPrice: evaluation.referencePrice }
          : {}),
        discountPercent: evaluation.discountPercent,
        ...(offer.imageUrl ? { imageUrl: offer.imageUrl } : {}),
        url: offer.url,
        ...(offer.hasVariantPrices ? { hasVariantPrices: true } : {}),
        ...(offer.rating !== undefined
          ? { rating: Math.round(offer.rating * 10) / 10 }
          : {}),
        ...(offer.salesCount !== undefined
          ? { salesCount: offer.salesCount }
          : {}),
        ...(offer.seller?.officialStore ? { official: true } : {}),
        ...(offer.seller?.name ? { seller: offer.seller.name } : {}),
        ...(category ? { category } : {}),
        ...(hotIds.has(offer.productId) ? { hot: true } : {}),
      };
    }),
  };
}

/** Escreve data/offers.json no clone do site e faz commit + push (GitHub Pages publica sozinho). */
export async function publishSite(
  siteDir: string,
  candidates: readonly Candidate[],
  options: {
    maxOffers: number;
    push: boolean;
    categories?: CategoryMap;
    /** URL pública do site; quando informada, avisa os buscadores (IndexNow) a cada atualização. */
    siteUrl?: string;
    log?: (message: string) => void;
  },
): Promise<{ count: number; changed: boolean }> {
  const log = options.log ?? console.log;
  const data = toSiteData(
    candidates,
    options.maxOffers,
    new Date(),
    options.categories ?? {},
  );
  const path = join(siteDir, "data", "offers.json");
  mkdirSync(join(siteDir, "data"), { recursive: true });

  // Só reescreve quando a lista mudou (GitHub Pages tem limite de ~10 builds por hora).
  if (existsSync(path)) {
    try {
      const previous = JSON.parse(readFileSync(path, "utf8")) as SiteData;
      if (JSON.stringify(previous.offers) === JSON.stringify(data.offers)) {
        log("[site] ofertas iguais às publicadas; nada a fazer.");
        return { count: data.offers.length, changed: false };
      }
    } catch {
      // arquivo inválido: segue e sobrescreve
    }
  }
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n", "utf8");

  if (!options.push) {
    log(
      `[site] offers.json atualizado (${data.offers.length} ofertas), sem push.`,
    );
    return { count: data.offers.length, changed: true };
  }
  const git = (...args: string[]) => run("git", ["-C", siteDir, ...args]);
  await git("add", "data/offers.json");
  const { stdout: status } = await git(
    "status",
    "--porcelain",
    "data/offers.json",
  );
  if (!status.trim()) {
    log("[site] sem mudanças para publicar.");
    return { count: data.offers.length, changed: false };
  }
  await git("commit", "-q", "-m", `Atualiza ofertas (${data.offers.length})`);
  await git("push", "-q");
  log(`[site] publicado: ${data.offers.length} ofertas.`);
  await pingIndexNow(options.siteUrl, log);
  return { count: data.offers.length, changed: true };
}

/** Chave do IndexNow; o arquivo <chave>.txt com esse conteúdo fica na raiz do site. */
export const INDEXNOW_KEY = "f08bd053dd9d80933d06489432129ea0";

/** Avisa Bing/Yandex/Seznam/Naver que a página mudou (Google não participa). Falha nunca derruba a rodada. */
export async function pingIndexNow(siteUrl: string | undefined, log: (message: string) => void): Promise<void> {
  if (!siteUrl) return;
  const base = siteUrl.replace(/\/$/, "");
  const url = `https://api.indexnow.org/indexnow?url=${encodeURIComponent(`${base}/`)}&key=${INDEXNOW_KEY}`;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    log(`[site] IndexNow: HTTP ${response.status}`);
  } catch (error) {
    log(`[site] IndexNow falhou: ${String(error)}`);
  }
}
