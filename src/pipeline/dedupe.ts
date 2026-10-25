import type { FiltrosConfig } from "../config.js";
import type { PublishedRow } from "../db.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
/** Brasil não tem horário de verão desde 2019: Brasília = UTC-3 fixo. */
const BRT_OFFSET_MS = -3 * 60 * 60 * 1000;

export type DedupeConfig = Pick<FiltrosConfig, "republishCooldownDays" | "republishExtraDropPercent">;
export type RateLimitConfig = Pick<
  FiltrosConfig,
  "maxPostsPerDay" | "minIntervalMinutesBetweenPosts"
>;

/**
 * Pode publicar de novo? Sim se nunca publicou, se passou o cooldown,
 * ou se o preço caiu pelo menos `republishExtraDropPercent` desde o último post.
 */
export function canRepublish(
  price: number,
  previous: PublishedRow | undefined,
  config: DedupeConfig,
  now: Date,
): boolean {
  if (!previous) {
    return true;
  }
  const elapsed = now.getTime() - new Date(previous.publishedAt).getTime();
  if (elapsed >= config.republishCooldownDays * DAY_MS) {
    return true;
  }
  return price <= previous.price * (1 - config.republishExtraDropPercent / 100);
}

/** Meia-noite de hoje no horário de Brasília. */
export function startOfDayBrt(now: Date): Date {
  const local = new Date(now.getTime() + BRT_OFFSET_MS);
  local.setUTCHours(0, 0, 0, 0);
  return new Date(local.getTime() - BRT_OFFSET_MS);
}

/**
 * Pode publicar agora, respeitando limite diário e intervalo mínimo?
 * Como há intervalo mínimo entre posts, cada execução publica no máximo 1.
 */
/** Sorteia o intervalo (em minutos) até o próximo post, entre min e max. */
export function nextIntervalMinutes(
  config: { minIntervalMinutesBetweenPosts: number; maxIntervalMinutesBetweenPosts?: number | undefined },
  random: () => number = Math.random,
): number {
  const min = config.minIntervalMinutesBetweenPosts;
  const max = Math.max(min, config.maxIntervalMinutesBetweenPosts ?? min);
  return min + Math.floor(random() * (max - min + 1));
}

export function canPostNow(
  state: { postsToday: number; lastPublishedAt: Date | undefined },
  config: RateLimitConfig,
  now: Date,
): boolean {
  if (state.postsToday >= config.maxPostsPerDay) {
    return false;
  }
  return (
    !state.lastPublishedAt ||
    now.getTime() - state.lastPublishedAt.getTime() >= config.minIntervalMinutesBetweenPosts * MINUTE_MS
  );
}
