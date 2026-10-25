import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { evaluateOffer } from "../src/pipeline/filter.js";
import { formatMessage } from "../src/publishers/format.js";
import { ShopeeClient, ShopeeSource, toOffer } from "../src/sources/shopee/index.js";
import { filtros, NOW } from "./helpers.js";

const node = {
  itemId: "58260597282",
  productName: "Headset Gamer RGB",
  price: 120,
  priceMin: 120,
  priceMax: 150,
  priceDiscountRate: 40,
  commissionRate: 0.08,
  sales: 2714,
  ratingStar: 4.9,
  imageUrl: "https://cf.shopee.com.br/file/x",
  shopName: "Loja",
  shopId: "1",
  shopType: [2],
  productCatIds: [100, 200],
  offerLink: "https://s.shopee.com.br/abc",
};

describe("Shopee toOffer", () => {
  it("converte o nó da API em Offer com link de afiliado e preço original", () => {
    const offer = toOffer(node, NOW);
    expect(offer).toMatchObject({
      source: "shopee",
      productId: "58260597282",
      price: 120,
      originalPrice: 200,
      hasVariantPrices: true,
      url: "https://s.shopee.com.br/abc",
      category: "200",
      rating: 4.9,
      salesCount: 2714,
      seller: { name: "Loja", officialStore: false, reputation: "shopee_preferred" },
    });
    expect(evaluateOffer(offer, [], filtros).accepted).toBe(true);
    expect(formatMessage({ offer, referencePrice: 200, discountPercent: 40, link: offer.url })).toContain(
      "por a partir de <b>R$ 120,00</b>",
    );
  });

  it("rejeita nota baixa, poucas vendas e loja comum", () => {
    expect(evaluateOffer(toOffer({ ...node, ratingStar: 4.1 }, NOW), [], filtros)).toMatchObject({ accepted: false });
    expect(evaluateOffer(toOffer({ ...node, sales: 10 }, NOW), [], filtros)).toMatchObject({ accepted: false });
    expect(evaluateOffer(toOffer({ ...node, shopType: [] }, NOW), [], filtros)).toMatchObject({ accepted: false });
    expect(evaluateOffer(toOffer({ ...node, shopType: [1] }, NOW), [], filtros).accepted).toBe(true);
  });
});

describe("ShopeeClient", () => {
  it("assina a requisição com SHA256(appId + timestamp + payload + secret)", async () => {
    let captured: { auth: string; body: string } | undefined;
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      captured = { auth: (init.headers as Record<string, string>).authorization ?? "", body: String(init.body) };
      return new Response(JSON.stringify({ data: { productOfferV2: { nodes: [node] } } }), { status: 200 });
    }) as typeof fetch;

    const source = new ShopeeSource(new ShopeeClient("app", "segredo", fakeFetch), { maxProductsPerTerm: 5 });
    const offers = await source.search(["headset"]);

    expect(offers).toHaveLength(1);
    const match = captured?.auth.match(/^SHA256 Credential=app, Timestamp=(\d+), Signature=([0-9a-f]{64})$/);
    expect(match).not.toBeNull();
    const expected = createHash("sha256").update(`app${match?.[1]}${captured?.body}segredo`).digest("hex");
    expect(match?.[2]).toBe(expected);
  });
});
