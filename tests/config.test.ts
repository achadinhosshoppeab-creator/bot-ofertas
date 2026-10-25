import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const validFiltros = {
  searchTerms: ["console"],
  highlightCategoryIds: ["MLB11172"],
  blockedWords: ["capa"],
  minDiscountPercentWithHistory: 15,
  minDiscountPercentWithoutHistory: 25,
  priceHistoryDays: 30,
  minPriceBrl: 50,
  requireOfficialOrHighReputation: true,
  republishCooldownDays: 7,
  republishExtraDropPercent: 5,
  maxPostsPerDay: 10,
  minIntervalMinutesBetweenPosts: 30,
};

describe("loadConfig", () => {
  it("carrega filtros.json do projeto e aplica defaults de env", () => {
    const config = loadConfig({
      cwd: process.cwd(),
      env: {
        DRY_RUN: "true",
      },
    });

    expect(config.env.DRY_RUN).toBe(true);
    expect(config.env.DATABASE_PATH).toBe("data/bot.db");
    expect(config.filtros.minPriceBrl).toBe(15);
    expect(config.filtros.searchTerms.length).toBeGreaterThan(0);
  });

  it("rejeita filtros.json inválido", () => {
    const dir = mkdtempSync(join(tmpdir(), "bot-ofertas-config-"));
    const path = join(dir, "filtros.json");
    writeFileSync(path, JSON.stringify({ searchTerms: [] }), "utf8");

    expect(() =>
      loadConfig({
        filtrosPath: path,
        env: {},
      }),
    ).toThrow();
  });

  it("aceita DRY_RUN como string false", () => {
    const dir = mkdtempSync(join(tmpdir(), "bot-ofertas-config-"));
    const path = join(dir, "filtros.json");
    writeFileSync(path, JSON.stringify(validFiltros), "utf8");

    const config = loadConfig({
      filtrosPath: path,
      env: { DRY_RUN: "false" },
    });

    expect(config.env.DRY_RUN).toBe(false);
  });
});
