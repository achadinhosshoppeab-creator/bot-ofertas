import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { hashtags, pinDescription, socialCaption } from "../src/content/caption.js";
import { buildCarousel, SLIDE_HEIGHT, SLIDE_WIDTH, wrapLines } from "../src/content/carousel.js";
import { makeOffer } from "./helpers.js";

const input = {
  offer: makeOffer({ title: "Garrafa Térmica 500ml Inox Para Academia", price: 27.98 }),
  referencePrice: 116.58,
  discountPercent: 76,
  brand: "Achadinhos",
};

describe("legendas", () => {
  it("monta legenda social com preço, bio, aviso e hashtags", () => {
    const caption = socialCaption(input);
    expect(caption).toContain("Garrafa Térmica 500ml");
    expect(caption).toContain("De R$ 116,58 por R$ 27,98 (76% off)");
    expect(caption).toMatch(/bio/i);
    expect(caption).not.toContain("afiliado");
    expect(caption).toContain("#achadinhos");
    expect(caption).toContain("#garrafa");
  });

  it("é estável por produto e varia entre produtos", () => {
    expect(socialCaption(input)).toBe(socialCaption(input));
    const other = { ...input, offer: makeOffer({ productId: "Z9", title: "Abajur Touch LED", price: 29.99 }) };
    expect(pinDescription(other)).not.toBe(pinDescription(input));
    expect(hashtags(other)).toContain("#abajur");
  });
});

describe("carrossel", () => {
  it("gera dois slides 1080x1920 a partir da imagem do produto", async () => {
    const fake = await sharp({ create: { width: 400, height: 300, channels: 3, background: "#3366cc" } }).png().toBuffer();
    const slides = await buildCarousel(input, async () => fake);
    expect(slides).toHaveLength(2);
    for (const slide of slides) {
      const meta = await sharp(slide).metadata();
      expect([meta.width, meta.height, meta.format]).toEqual([SLIDE_WIDTH, SLIDE_HEIGHT, "jpeg"]);
    }
  });

  it("quebra e limita linhas do título", () => {
    expect(wrapLines("um dois tres quatro cinco", 9, 2)).toEqual(["um dois", "tres qua…"]);
  });
});
