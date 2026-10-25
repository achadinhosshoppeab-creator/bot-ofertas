import { describe, expect, it } from "vitest";
import { evaluateOffer, findBlockedWord } from "../src/pipeline/filter.js";
import { median } from "../src/pipeline/history.js";
import { daysAgo, filtros, makeOffer } from "./helpers.js";

describe("median", () => {
  it("calcula para quantidade par e ímpar", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeUndefined();
  });
});

describe("findBlockedWord", () => {
  it("ignora acento e caixa, e só casa palavra inteira", () => {
    expect(findBlockedWord("PELÍCULA de vidro PS5", ["pelicula"])).toBe("pelicula");
    expect(findBlockedWord("Console Usado", ["usado"])).toBe("usado");
    expect(findBlockedWord("Monitor Capacitivo", ["capa"])).toBeUndefined();
  });
});

describe("evaluateOffer", () => {
  it("rejeita palavra bloqueada, preço baixo e vendedor fraco", () => {
    expect(evaluateOffer(makeOffer({ title: "Capa para controle" }), [], filtros)).toMatchObject({ accepted: false });
    expect(evaluateOffer(makeOffer({ price: 30, originalPrice: 100 }), [], filtros)).toMatchObject({
      accepted: false,
      reason: expect.stringContaining("abaixo"),
    });
    expect(
      evaluateOffer(makeOffer({ seller: { name: "x", reputation: "3_yellow" } }), [], filtros),
    ).toMatchObject({ accepted: false, reason: expect.stringContaining("vendedor") });
  });

  it("aceita loja oficial mesmo sem reputação alta", () => {
    const offer = makeOffer({ seller: { name: "x", reputation: "3_yellow", officialStore: true } });
    expect(evaluateOffer(offer, [], filtros).accepted).toBe(true);
  });

  it("sem histórico usa desconto da loja com mínimo de 25%", () => {
    expect(evaluateOffer(makeOffer({ price: 450, originalPrice: 600 }), [], filtros)).toMatchObject({
      accepted: true,
      basis: "store",
      discountPercent: 25,
      referencePrice: 600,
    });
    expect(evaluateOffer(makeOffer({ price: 460, originalPrice: 600 }), [], filtros).accepted).toBe(false);
    const { originalPrice: _, ...withoutOriginal } = makeOffer();
    expect(evaluateOffer(withoutOriginal, [], filtros).accepted).toBe(false);
  });

  it("rejeita desconto da loja inflado", () => {
    expect(evaluateOffer(makeOffer({ price: 60, originalPrice: 700 }), [], filtros)).toMatchObject({
      accepted: false,
      reason: expect.stringContaining("inflado"),
    });
  });

  it("com histórico suficiente usa a mediana e exige 15%", () => {
    const history = [
      { price: 500, fetchedAt: daysAgo(20) },
      { price: 500, fetchedAt: daysAgo(10) },
      { price: 520, fetchedAt: daysAgo(5) },
    ];
    // 500 → 420 = 16% (ignora o original_price inflado da loja)
    expect(evaluateOffer(makeOffer({ price: 420, originalPrice: 1000 }), history, filtros)).toMatchObject({
      accepted: true,
      basis: "history",
      referencePrice: 500,
      discountPercent: 16,
      lowestInDays: 20,
    });
    // 500 → 450 = 10%: rejeita mesmo com "50% off" da loja
    expect(evaluateOffer(makeOffer({ price: 450, originalPrice: 900 }), history, filtros).accepted).toBe(false);
  });

  it("histórico curto demais cai para o desconto da loja", () => {
    const history = [{ price: 400, fetchedAt: daysAgo(1) }];
    expect(evaluateOffer(makeOffer({ price: 400, originalPrice: 600 }), history, filtros)).toMatchObject({
      accepted: true,
      basis: "store",
    });
  });
});
