const DAY_MS = 24 * 60 * 60 * 1000;

export type PricePoint = { price: number; fetchedAt: string };

export function median(values: readonly number[]): number | undefined {
  if (values.length === 0) {
    return undefined;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2
    : (sorted[mid] as number);
}

/** Quantos dias (inteiros, mínimo 1) o histórico cobre até `now`. */
export function historySpanDays(history: readonly PricePoint[], now: Date): number {
  const first = history[0];
  if (!first) {
    return 0;
  }
  return Math.max(1, Math.floor((now.getTime() - new Date(first.fetchedAt).getTime()) / DAY_MS));
}

/**
 * Se `price` é o menor do histórico, retorna há quantos dias isso vale
 * (para "Menor preço em N dias"); senão `undefined`.
 */
export function lowestPriceDays(
  price: number,
  history: readonly PricePoint[],
  now: Date,
): number | undefined {
  if (history.length === 0 || history.some((point) => point.price < price)) {
    return undefined;
  }
  return historySpanDays(history, now);
}
