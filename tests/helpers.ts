import type { FiltrosConfig } from "../src/config.js";
import type { Offer } from "../src/sources/types.js";

export const NOW = new Date("2026-10-12T15:00:00.000Z");

export const filtros: FiltrosConfig = {
  searchTerms: ["organizador cozinha"],
  highlightCategoryIds: [],
  categories: {},
  maxProductsPerTerm: 15,
  blockedWords: ["capa", "usado", "película"],
  minDiscountPercentWithHistory: 15,
  minDiscountPercentWithoutHistory: 25,
  maxStoreDiscountPercent: 80,
  priceHistoryDays: 30,
  minHistoryDays: 3,
  minPriceBrl: 50,
  minRating: 4.5,
  minSales: 50,
  minCommissionRate: 0,
  commissionWeight: 0.5,
  requireOfficialOrHighReputation: true,
  republishCooldownDays: 7,
  republishExtraDropPercent: 5,
  maxPostsPerDay: 10,
  minIntervalMinutesBetweenPosts: 30,
};

export function makeOffer(overrides: Partial<Offer> = {}): Offer {
  return {
    source: "mercadolivre",
    productId: "MLB1",
    title: "SSD NVMe Kingston NV3 1TB",
    price: 400,
    originalPrice: 600,
    url: "https://produto.mercadolivre.com.br/MLB-123",
    imageUrl: "https://http2.mlstatic.com/foto.jpg",
    seller: { name: "LOJA", reputation: "5_green" },
    fetchedAt: NOW,
    ...overrides,
  };
}

export function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}
