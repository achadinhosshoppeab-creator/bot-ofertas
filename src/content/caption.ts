import { createHash } from "node:crypto";
import type { Offer } from "../sources/types.js";
import { shortTitle } from "../publishers/format.js";

const brl = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export type CaptionInput = {
  offer: Offer;
  referencePrice: number;
  discountPercent: number;
  brand: string;
  /** Hashtags extras por nicho (sem #). */
  tags?: string[];
  /** Username do canal do Telegram (sem @) para citar na legenda. */
  telegram?: string;
};

const OPENERS = [
  "Achadinho do dia 🛍️",
  "Olha o preço disso 👀",
  "Não dá pra ignorar esse desconto 😱",
  "Esse eu precisei compartilhar ✨",
  "Achei barato demais 🔥",
  "Pra quem estava esperando baixar ⬇️",
];

const CTAS = [
  "Comenta EU QUERO que eu te mando o link 💬",
  "Quer o link? Comenta EU QUERO 👇",
  "Comenta EU QUERO antes que acabe 🏃 (ou pega na bio)",
  "EU QUERO nos comentários que eu mando no privado 📩",
];

const BASE_TAGS = ["achadinhos", "achadinhosshopee", "shopee", "promocao", "oferta", "desconto"];

/** Escolha estável por produto, para variar entre posts sem sortear a cada execução. */
export function pick<T>(items: readonly T[], seed: string, salt = ""): T {
  const hash = createHash("sha1").update(`${seed}:${salt}`).digest();
  return items[(hash[0] as number) % items.length] as T;
}

export function hashtags(input: Pick<CaptionInput, "offer" | "tags">): string[] {
  const words = input.offer.title
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 5 && word.length <= 14)
    .slice(0, 3);
  return [...new Set([...BASE_TAGS, ...(input.tags ?? []), ...words])].map((tag) => `#${tag}`);
}

/** Legenda para TikTok/Instagram (link não clicável, chama para a bio). */
export function socialCaption(input: CaptionInput): string {
  const { offer } = input;
  const opener = pick(OPENERS, offer.productId, "opener");
  const cta = pick(CTAS, offer.productId, "cta");
  const price = `${offer.hasVariantPrices ? "a partir de " : ""}R$ ${brl.format(offer.price)}`;

  return [
    `${opener} ${shortTitle(offer.title, 70)}`,
    `De R$ ${brl.format(input.referencePrice)} por ${price} (${Math.round(input.discountPercent)}% off)`,
    cta,
    ...(input.telegram ? [`📲 Todas as ofertas do dia no Telegram: t.me/${input.telegram}`] : []),
    "",
    hashtags(input).join(" "),
  ].join("\n");
}

/** Descrição para o Pinterest (link clicável no pin; precisa ser única por pin). */
export function pinDescription(input: CaptionInput): string {
  const { offer } = input;
  const opener = pick(OPENERS, offer.productId, "pin");
  return [
    `${opener} ${shortTitle(offer.title, 80)}`,
    `De R$ ${brl.format(input.referencePrice)} por R$ ${brl.format(offer.price)} (${Math.round(input.discountPercent)}% off) na Shopee.`,
    `Mais achadinhos em ${input.brand}.`,
    hashtags(input).slice(0, 6).join(" "),
  ].join(" ");
}
