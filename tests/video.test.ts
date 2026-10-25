import { describe, expect, it } from "vitest";
import { spokenScript, spokenTitle } from "../src/content/video.js";
import { makeOffer } from "./helpers.js";

describe("narração", () => {
  it("fala só o começo do título, sem códigos", () => {
    expect(spokenTitle("Garrafa Térmica WATERSY 500ml - 48h Frio! Perfeita para Academia")).toBe("garrafa térmica watersy 500ml");
    expect(spokenTitle("Headset Gamer TGT Diver V2, Rainbow, Drivers 40mm, TGT-DVR-RGB02")).toBe("headset gamer tgt diver v2");
  });

  it("monta a frase com preço em reais e centavos", () => {
    const text = spokenScript({ offer: makeOffer({ title: "Abajur Touch LED", price: 29.99 }), discountPercent: 70, brand: "x" });
    expect(text).toBe("Olha esse achadinho: abajur touch led, por 29 reais e 99 centavos, com 70 por cento de desconto. Comenta eu quero que eu te mando o link.");
  });
});
