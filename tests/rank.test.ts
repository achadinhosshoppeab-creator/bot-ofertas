import { describe, expect, it } from "vitest";
import { rankScore } from "../src/pipeline/rank.js";

const c = (discountPercent: number, commissionRate?: number) => ({ offer: { commissionRate }, evaluation: { discountPercent } });

describe("rankScore", () => {
  it("com peso 0 ordena só por desconto", () => {
    expect(rankScore(c(50, 0.2), 0)).toBeCloseTo(0.5);
    expect(rankScore(c(50, 0.03), 0)).toBeCloseTo(0.5);
  });

  it("comissão alta compensa desconto menor", () => {
    expect(rankScore(c(30, 0.15), 0.5)).toBeGreaterThan(rankScore(c(60, 0.03), 0.5));
  });

  it("comissão acima de 20% não pontua mais e sem comissão conta zero", () => {
    expect(rankScore(c(0, 0.28), 1)).toBe(1);
    expect(rankScore(c(40, undefined), 0.5)).toBeCloseTo(0.2);
  });
});
