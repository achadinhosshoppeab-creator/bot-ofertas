import { describe, expect, it, afterEach } from "vitest";
import {
  closeDatabase,
  getPricesLastDays,
  getPublished,
  insertPriceHistory,
  openDatabase,
  upsertPublished,
  type Db,
} from "../src/db.js";

describe("db", () => {
  let db: Db;

  afterEach(() => {
    if (db) {
      closeDatabase(db);
    }
  });

  it("migra tabelas e persiste histórico de preços", () => {
    db = openDatabase(":memory:");

    insertPriceHistory(db, {
      productId: "MLB1",
      source: "mercadolivre",
      price: 199.9,
      fetchedAt: "2026-10-01T12:00:00.000Z",
    });
    insertPriceHistory(db, {
      productId: "MLB1",
      source: "mercadolivre",
      price: 149.9,
      fetchedAt: "2026-10-03T12:00:00.000Z",
    });

    const prices = getPricesLastDays(db, {
      productId: "MLB1",
      source: "mercadolivre",
      days: 30,
      now: new Date("2026-10-03T15:00:00.000Z"),
    });

    expect(prices).toEqual([199.9, 149.9]);
  });

  it("ignora preços fora da janela de dias", () => {
    db = openDatabase(":memory:");

    insertPriceHistory(db, {
      productId: "MLB2",
      source: "mercadolivre",
      price: 500,
      fetchedAt: "2026-08-01T00:00:00.000Z",
    });
    insertPriceHistory(db, {
      productId: "MLB2",
      source: "mercadolivre",
      price: 400,
      fetchedAt: "2026-10-01T00:00:00.000Z",
    });

    const prices = getPricesLastDays(db, {
      productId: "MLB2",
      source: "mercadolivre",
      days: 30,
      now: new Date("2026-10-03T00:00:00.000Z"),
    });

    expect(prices).toEqual([400]);
  });

  it("faz upsert em published e permite consultar", () => {
    db = openDatabase(":memory:");

    upsertPublished(db, {
      productId: "MLB3",
      source: "mercadolivre",
      price: 999,
      publishedAt: "2026-10-01T10:00:00.000Z",
      messageId: "100",
    });

    upsertPublished(db, {
      productId: "MLB3",
      source: "mercadolivre",
      price: 899,
      publishedAt: "2026-10-03T10:00:00.000Z",
      messageId: "101",
    });

    const published = getPublished(db, {
      productId: "MLB3",
      source: "mercadolivre",
    });

    expect(published).toEqual({
      productId: "MLB3",
      source: "mercadolivre",
      price: 899,
      publishedAt: "2026-10-03T10:00:00.000Z",
      messageId: "101",
    });
  });
});

describe("markOffersSeen", () => {
  it("conta só as ofertas que nunca apareceram", async () => {
    const { markOffersSeen } = await import("../src/db.js");
    const db = openDatabase(":memory:");
    const a = { productId: "A", source: "shopee" };
    const b = { productId: "B", source: "shopee" };
    expect(markOffersSeen(db, [a, b], new Date("2026-10-25T10:00:00Z"))).toBe(2);
    expect(markOffersSeen(db, [a, b, { productId: "C", source: "shopee" }], new Date("2026-10-25T10:10:00Z"))).toBe(1);
    expect(markOffersSeen(db, [a], new Date("2026-10-25T10:20:00Z"))).toBe(0);
    closeDatabase(db);
  });
});
