import { afterEach, describe, expect, it } from "vitest";
import { MercadoLivreAffiliateLinker } from "../src/affiliate/mercadolivre.js";
import { closeDatabase, getPublished, insertPriceHistory, openDatabase, type Db } from "../src/db.js";
import type { Publisher } from "../src/publishers/types.js";
import { runOnce } from "../src/run.js";
import type { Offer, OfferSource } from "../src/sources/types.js";
import { filtros, makeOffer, NOW } from "./helpers.js";

class FakeSource implements OfferSource {
  readonly name = "fake";
  constructor(private readonly offers: Offer[]) {}
  async search(): Promise<Offer[]> {
    return this.offers;
  }
}

class FakePublisher implements Publisher {
  readonly name = "fake";
  sent: string[] = [];
  async publish(input: { text: string }): Promise<string> {
    this.sent.push(input.text);
    return String(this.sent.length);
  }
}

describe("runOnce", () => {
  let db: Db;
  afterEach(() => closeDatabase(db));

  const offers = [
    makeOffer({ productId: "A", title: "SSD A 1TB", price: 450, originalPrice: 600 }), // 25%
    makeOffer({ productId: "B", title: "SSD B 1TB", price: 300, originalPrice: 600 }), // 50%
    makeOffer({ productId: "C", title: "Capa SSD", price: 100, originalPrice: 600 }),
  ];

  const deps = (publisher: Publisher, dryRun: boolean, now = NOW) => ({
    db,
    source: new FakeSource(offers),
    linker: new MercadoLivreAffiliateLinker("123"),
    publisher,
    filtros,
    dryRun,
    now: () => now,
    log: () => {},
  });

  it("dry-run lista candidatos, grava histórico e não publica", async () => {
    db = openDatabase(":memory:");
    const publisher = new FakePublisher();
    const result = await runOnce(deps(publisher, true));

    expect(result.candidates.map((c) => c.offer.productId)).toEqual(["B", "A"]);
    expect(publisher.sent).toEqual([]);
    expect(getPublished(db, { productId: "B", source: "mercadolivre" })).toBeUndefined();
    const count = db.prepare("SELECT COUNT(*) AS n FROM price_history").get() as { n: number };
    expect(count.n).toBe(3);
  });

  it("publica a melhor oferta, respeita intervalo e não repete", async () => {
    db = openDatabase(":memory:");
    const publisher = new FakePublisher();

    const first = await runOnce(deps(publisher, false));
    expect(first.published.map((p) => p.offer.productId)).toEqual(["B"]);
    expect(publisher.sent[0]).toContain("matt_tool=123");

    // 10 min depois: intervalo mínimo bloqueia
    const second = await runOnce(deps(publisher, false, new Date(NOW.getTime() + 10 * 60 * 1000)));
    expect(second.published).toEqual([]);

    // 40 min depois: publica A, não repete B
    const third = await runOnce(deps(publisher, false, new Date(NOW.getTime() + 40 * 60 * 1000)));
    expect(third.published.map((p) => p.offer.productId)).toEqual(["A"]);
    expect(publisher.sent).toHaveLength(2);
  });

  it("remove o mesmo produto vindo de lojas diferentes, mantendo o maior desconto", async () => {
    db = openDatabase(":memory:");
    const source = new FakeSource([
      makeOffer({ productId: "X1", title: "Teclado Gamer RGB", price: 400, originalPrice: 600 }),
      makeOffer({ productId: "X2", title: "teclado  gamer rgb", price: 300, originalPrice: 600 }),
    ]);
    const result = await runOnce({ ...deps(new FakePublisher(), true), source });
    expect(result.candidates.map((c) => c.offer.productId)).toEqual(["X2"]);
  });

  it("usa o histórico de preços em vez do desconto da loja quando existe", async () => {
    db = openDatabase(":memory:");
    for (const days of [20, 10, 5]) {
      insertPriceHistory(db, {
        productId: "B",
        source: "mercadolivre",
        price: 320,
        fetchedAt: new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000),
      });
    }
    const result = await runOnce(deps(new FakePublisher(), true));
    // B: 320 → 300 é só 6% sobre a mediana; o "50% off" da loja não conta.
    expect(result.candidates.map((c) => c.offer.productId)).toEqual(["A"]);
  });
});
