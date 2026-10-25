import { describe, expect, it } from "vitest";
import { canPostNow, canRepublish, startOfDayBrt } from "../src/pipeline/dedupe.js";
import { daysAgo, filtros, NOW } from "./helpers.js";

const published = (price: number, days: number) => ({
  productId: "MLB1",
  source: "mercadolivre",
  price,
  publishedAt: daysAgo(days),
  messageId: "1",
});

describe("canRepublish", () => {
  it("permite se nunca publicou ou se passou o cooldown", () => {
    expect(canRepublish(100, undefined, filtros, NOW)).toBe(true);
    expect(canRepublish(100, published(100, 8), filtros, NOW)).toBe(true);
  });

  it("dentro do cooldown só com queda adicional de 5%", () => {
    expect(canRepublish(100, published(100, 2), filtros, NOW)).toBe(false);
    expect(canRepublish(96, published(100, 2), filtros, NOW)).toBe(false);
    expect(canRepublish(95, published(100, 2), filtros, NOW)).toBe(true);
  });
});

describe("canPostNow", () => {
  it("respeita limite diário e intervalo mínimo", () => {
    expect(canPostNow({ postsToday: 0, lastPublishedAt: undefined }, filtros, NOW)).toBe(true);
    expect(canPostNow({ postsToday: 10, lastPublishedAt: undefined }, filtros, NOW)).toBe(false);
    const tenMinAgo = new Date(NOW.getTime() - 10 * 60 * 1000);
    expect(canPostNow({ postsToday: 1, lastPublishedAt: tenMinAgo }, filtros, NOW)).toBe(false);
    const hourAgo = new Date(NOW.getTime() - 60 * 60 * 1000);
    expect(canPostNow({ postsToday: 1, lastPublishedAt: hourAgo }, filtros, NOW)).toBe(true);
  });
});

describe("startOfDayBrt", () => {
  it("usa meia-noite de Brasília (03:00 UTC)", () => {
    expect(startOfDayBrt(new Date("2026-10-12T15:00:00Z")).toISOString()).toBe("2026-10-12T03:00:00.000Z");
    // 01:00 UTC ainda é dia 11 em Brasília
    expect(startOfDayBrt(new Date("2026-10-12T01:00:00Z")).toISOString()).toBe("2026-10-11T03:00:00.000Z");
  });
});

describe("nextIntervalMinutes", () => {
  it("sorteia entre min e max, inclusive", async () => {
    const { nextIntervalMinutes } = await import("../src/pipeline/dedupe.js");
    const cfg = { minIntervalMinutesBetweenPosts: 1, maxIntervalMinutesBetweenPosts: 5 };
    expect(nextIntervalMinutes(cfg, () => 0)).toBe(1);
    expect(nextIntervalMinutes(cfg, () => 0.999)).toBe(5);
    expect(nextIntervalMinutes({ minIntervalMinutesBetweenPosts: 20 }, () => 0.5)).toBe(20);
  });
});
