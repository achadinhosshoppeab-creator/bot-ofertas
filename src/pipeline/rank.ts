import type { Offer } from "../sources/types.js";

/** Comissão a partir da qual o produto já conta como "máxima" no ranking (20%). */
const COMMISSION_CAP = 0.2;

export type Rankable = { offer: { commissionRate?: Offer["commissionRate"] }; evaluation: { discountPercent: number } };

/**
 * Pontuação 0..1 que mistura desconto e comissão de afiliado.
 * `weight` 0 = só desconto; 1 = só comissão. Sem comissão informada, conta como zero.
 */
export function rankScore(candidate: Rankable, weight: number): number {
  const discount = Math.min(Math.max(candidate.evaluation.discountPercent, 0), 100) / 100;
  const commission = Math.min((candidate.offer.commissionRate ?? 0) / COMMISSION_CAP, 1);
  return (1 - weight) * discount + weight * commission;
}
