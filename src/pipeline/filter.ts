import type { FiltrosConfig } from "../config.js";
import type { Offer } from "../sources/types.js";
import { historySpanDays, lowestPriceDays, median, type PricePoint } from "./history.js";

export type FilterConfig = Pick<
  FiltrosConfig,
  | "blockedWords"
  | "minPriceBrl"
  | "requireOfficialOrHighReputation"
  | "minDiscountPercentWithHistory"
  | "minDiscountPercentWithoutHistory"
  | "maxStoreDiscountPercent"
  | "minHistoryDays"
  | "minRating"
  | "minSales"
  | "minCommissionRate"
>;

export type Evaluation =
  | {
      accepted: true;
      /** Preço de referência ("De R$ ...") — mediana do histórico ou preço original da loja. */
      referencePrice: number;
      discountPercent: number;
      basis: "history" | "store";
      lowestInDays?: number;
    }
  | { accepted: false; reason: string };

const HIGH_REPUTATION_LEVELS = new Set(["5_green", "shopee_preferred"]);
const HIGH_POWER_SELLER = new Set(["platinum", "gold"]);

export function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

export function findBlockedWord(title: string, blockedWords: readonly string[]): string | undefined {
  const words = new Set(normalize(title).split(/[^\p{L}\p{N}]+/u));
  return blockedWords.find((blocked) => {
    const normalized = normalize(blocked);
    return normalized.includes(" ")
      ? normalize(title).includes(normalized)
      : words.has(normalized);
  });
}

export function isTrustedSeller(offer: Offer): boolean {
  const seller = offer.seller;
  if (!seller) {
    return false;
  }
  return (
    seller.officialStore === true ||
    (seller.reputation !== undefined && HIGH_REPUTATION_LEVELS.has(seller.reputation)) ||
    (seller.powerSellerStatus !== undefined && HIGH_POWER_SELLER.has(seller.powerSellerStatus))
  );
}

function discountPercent(reference: number, price: number): number {
  return Math.round(((reference - price) / reference) * 1000) / 10;
}

/**
 * Decide se a oferta é boa o bastante para publicar.
 * `history` são os preços anteriores (sem a coleta atual), em ordem cronológica.
 */
export function evaluateOffer(
  offer: Offer,
  history: readonly PricePoint[],
  config: FilterConfig,
  now: Date = offer.fetchedAt,
): Evaluation {
  const blocked = findBlockedWord(offer.title, config.blockedWords);
  if (blocked) {
    return { accepted: false, reason: `palavra bloqueada: ${blocked}` };
  }
  if (offer.price < config.minPriceBrl) {
    return { accepted: false, reason: `preço abaixo de R$ ${config.minPriceBrl}` };
  }
  if (config.requireOfficialOrHighReputation && !isTrustedSeller(offer)) {
    return { accepted: false, reason: "vendedor sem loja oficial/reputação alta" };
  }
  if (offer.rating !== undefined && offer.rating < config.minRating) {
    return { accepted: false, reason: `nota abaixo de ${config.minRating}` };
  }
  if (offer.salesCount !== undefined && offer.salesCount < config.minSales) {
    return { accepted: false, reason: `menos de ${config.minSales} vendas` };
  }
  if (offer.commissionRate !== undefined && offer.commissionRate < config.minCommissionRate) {
    return { accepted: false, reason: `comissão abaixo de ${Math.round(config.minCommissionRate * 100)}%` };
  }

  const lowestInDays = lowestPriceDays(offer.price, history, now);
  const lowest = lowestInDays !== undefined ? { lowestInDays } : {};

  const reference = median(history.map((point) => point.price));
  if (reference !== undefined && historySpanDays(history, now) >= config.minHistoryDays) {
    const discount = discountPercent(reference, offer.price);
    if (discount < config.minDiscountPercentWithHistory) {
      return {
        accepted: false,
        reason: `desconto ${discount}% sobre a mediana (mín. ${config.minDiscountPercentWithHistory}%)`,
      };
    }
    return { accepted: true, referencePrice: reference, discountPercent: discount, basis: "history", ...lowest };
  }

  if (offer.originalPrice === undefined || offer.originalPrice <= offer.price) {
    return { accepted: false, reason: "sem histórico e sem desconto da loja" };
  }
  const discount = discountPercent(offer.originalPrice, offer.price);
  if (discount > config.maxStoreDiscountPercent) {
    return { accepted: false, reason: `desconto da loja ${discount}% parece inflado` };
  }
  if (discount < config.minDiscountPercentWithoutHistory) {
    return {
      accepted: false,
      reason: `desconto da loja ${discount}% (mín. ${config.minDiscountPercentWithoutHistory}% sem histórico)`,
    };
  }
  return { accepted: true, referencePrice: offer.originalPrice, discountPercent: discount, basis: "store", ...lowest };
}
