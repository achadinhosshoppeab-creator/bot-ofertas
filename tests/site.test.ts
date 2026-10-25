import { describe, expect, it } from "vitest";
import { toSiteData } from "../src/site/publish.js";
import { makeOffer, NOW } from "./helpers.js";

describe("toSiteData", () => {
  it("converte candidatos no JSON da página, limitado a max", () => {
    const candidates = [
      { offer: makeOffer({ productId: "A", price: 20, hasVariantPrices: true }), evaluation: { accepted: true as const, referencePrice: 50, discountPercent: 60, basis: "store" as const } },
      { offer: makeOffer({ productId: "B", price: 30 }), evaluation: { accepted: true as const, referencePrice: 40, discountPercent: 25, basis: "store" as const } },
    ];
    const data = toSiteData(candidates, 1, NOW);
    expect(data.updatedAt).toBe(NOW.toISOString());
    expect(data.offers).toHaveLength(1);
    expect(data.offers[0]).toMatchObject({
      id: "A", title: candidates[0]!.offer.title, price: 20, originalPrice: 50, discountPercent: 60, imageUrl: "https://http2.mlstatic.com/foto.jpg", url: "https://produto.mercadolivre.com.br/MLB-123", hasVariantPrices: true,
    });
  });
});

describe("toSiteData categorias", () => {
  it("mapeia o termo de busca para o grupo do site", () => {
    const candidates = [
      { offer: makeOffer({ productId: "A", searchTerm: "batom" }), evaluation: { accepted: true as const, referencePrice: 50, discountPercent: 60, basis: "store" as const } },
      { offer: makeOffer({ productId: "B", searchTerm: "sem grupo" }), evaluation: { accepted: true as const, referencePrice: 50, discountPercent: 60, basis: "store" as const } },
    ];
    const data = toSiteData(candidates, 10, NOW, { Beleza: ["batom", "skincare"] });
    expect(data.offers[0]?.category).toBe("Beleza");
    expect(data.offers[1]?.category).toBeUndefined();
  });
});

describe("toSiteData destaque", () => {
  it("marca como hot as mais vendidas com desconto alto", () => {
    const mk = (id: string, sales: number, discount: number) => ({
      offer: makeOffer({ productId: id, salesCount: sales, price: 30 }),
      evaluation: { accepted: true as const, referencePrice: 100, discountPercent: discount, basis: "store" as const },
    });
    const candidates = [mk("fraca", 10, 30), ...Array.from({ length: 8 }, (_, i) => mk(`top${i}`, 5000, 60)), mk("media", 100, 40)];
    const data = toSiteData(candidates, 20, NOW);
    expect(data.offers.filter((o) => o.hot)).toHaveLength(8);
    expect(data.offers.find((o) => o.id === "fraca")?.hot).toBeUndefined();
    expect(data.offers.find((o) => o.id === "top3")?.hot).toBe(true);
  });
});
