import { describe, expect, it } from "vitest";
import { MercadoLivreAffiliateLinker } from "../src/affiliate/mercadolivre.js";
import { formatMessage, shortTitle } from "../src/publishers/format.js";
import { itemUrl } from "../src/sources/mercadolivre/source.js";
import { makeOffer } from "./helpers.js";

describe("formatMessage", () => {
  it("monta a legenda com preços e menor preço", () => {
    const text = formatMessage({
      offer: makeOffer({ title: "SSD <Kingston> & cia", price: 1234.5 }),
      referencePrice: 1500,
      discountPercent: 17.7,
      lowestInDays: 30,
      link: "https://x.com/?a=1&b=2",
    });
    expect(text).toContain("🛍️ <b>SSD &lt;Kingston&gt; &amp; cia</b>");
    expect(text).toContain("De R$ 1.500,00 por <b>R$ 1.234,50</b> (18% off)");
    expect(text).toContain("Menor preço em 30 dias");
    expect(text).toContain("https://x.com/?a=1&amp;b=2");
    expect(text).not.toContain("afiliado");
  });

  it("omite 'menor preço' com histórico curto", () => {
    const text = formatMessage({ offer: makeOffer(), referencePrice: 600, discountPercent: 33, lowestInDays: 2, link: "l" });
    expect(text).not.toContain("Menor preço");
  });

  it("encurta títulos longos na palavra", () => {
    const title = shortTitle("palavra ".repeat(30), 40);
    expect(title.length).toBeLessThanOrEqual(40);
    expect(title.endsWith("…")).toBe(true);
  });
});

describe("links", () => {
  it("monta URL do anúncio e adiciona parâmetros de afiliado", async () => {
    expect(itemUrl("MLB4036053887")).toBe("https://produto.mercadolivre.com.br/MLB-4036053887");
    const link = await new MercadoLivreAffiliateLinker("123", "canal").buildLink(makeOffer());
    expect(link).toBe("https://produto.mercadolivre.com.br/MLB-123?matt_tool=123&matt_word=canal");
  });
});
