import type { Offer } from "../sources/types.js";

const TITLE_MAX = 90;
const brl = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export type MessageInput = {
  offer: Offer;
  referencePrice: number;
  discountPercent: number;
  lowestInDays?: number;
  link: string;
};

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function shortTitle(title: string, max = TITLE_MAX): string {
  const clean = title.replace(/\s+/g, " ").trim();
  if (clean.length <= max) {
    return clean;
  }
  const cut = clean.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/** Legenda em HTML do Telegram (cabe no limite de 1024 caracteres do sendPhoto). */
export function formatMessage(input: MessageInput): string {
  const lines = [
    `🛍️ <b>${escapeHtml(shortTitle(input.offer.title))}</b>`,
    "",
    `De R$ ${brl.format(input.referencePrice)} por ${input.offer.hasVariantPrices ? "a partir de " : ""}<b>R$ ${brl.format(input.offer.price)}</b> (${Math.round(input.discountPercent)}% off)`,
  ];
  if (input.lowestInDays !== undefined && input.lowestInDays >= 7) {
    lines.push(`Menor preço em ${input.lowestInDays} dias`);
  }
  lines.push("", `🛒 ${escapeHtml(input.link)}`);
  return lines.join("\n");
}
