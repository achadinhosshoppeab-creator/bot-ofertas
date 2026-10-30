import { createHash } from "node:crypto";
import type { Offer } from "../sources/types.js";
import { shortTitle } from "../publishers/format.js";

const brl = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export type CaptionInput = {
  offer: Offer;
  referencePrice: number;
  discountPercent: number;
  brand: string;
  /** Categoria do site (ex.: "Moda"); vira hashtags da área. */
  category?: string;
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

/** Tags por categoria do site (config/filtros.json → categories). */
const CATEGORY_TAGS: Record<string, string[]> = {
  "Casa e organização": ["organizacao", "casaarrumada", "decoracao"],
  Cozinha: ["cozinha", "utensilios", "cozinhacriativa"],
  Eletrônicos: ["tech", "gadgets", "tecnologia"],
  Beleza: ["beleza", "skincare", "maquiagem"],
  Moda: ["modafeminina", "lookdodia", "moda"],
  "Pet e bebê": ["pet", "maternidade", "bebe"],
  Ferramentas: ["ferramentas", "faztudo", "diy"],
  "Presentes e papelaria": ["papelaria", "presentes", "fofura"],
};
/** Completa até 5 quando faltar tag específica. */
const FILLER_TAGS = ["dicadecompra", "comprinhas", "baratinho", "valeapena", "descontao", "precobaixo"];
const MAX_TAGS = 5;
/** Palavras de título que não descrevem o produto. */
const STOP_WORDS = new Set([
  "premium", "promocao", "oferta", "kit", "unidades", "unidade", "original", "feminino", "feminina", "masculino", "masculina",
  "adulto", "infantil", "com", "para", "sem", "cor", "cores", "tamanho", "novo", "nova", "alta", "alto", "baixa", "baixo",
  "espessura", "elevador", "frontal", "fechamento", "qualidade", "super", "extra", "grande", "pequeno", "medio", "plus",
  "pro", "max", "mini", "top", "lancamento", "envio", "imediato", "pronta", "entrega", "atacado", "varejo", "promo",
  "pecas", "peca", "conjunto", "modelo", "estilo", "tipo", "total", "frete", "gratis", "barato", "melhor", "oferta",
]);

/** Escolha estável por produto, para variar entre posts sem sortear a cada execução. */
export function pick<T>(items: readonly T[], seed: string, salt = ""): T {
  const hash = createHash("sha1").update(`${seed}:${salt}`).digest();
  return items[(hash[0] as number) % items.length] as T;
}

const slug = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ");

/**
 * No máximo 5 hashtags, do específico para o geral: até 3 palavras do nome do produto
 * (ex.: calca, pantalona, alfaiataria), depois a categoria (moda, lookdodia) e, se faltar, uma de nicho.
 */
export function hashtags(input: Pick<CaptionInput, "offer" | "tags" | "category">): string[] {
  const words = slug(input.offer.title)
    .split(/\s+/)
    .filter((word) => word.length >= 4 && word.length <= 14 && !/\d/.test(word) && !STOP_WORDS.has(word))
    .slice(0, 3);
  let category = input.category ? (CATEGORY_TAGS[input.category] ?? []) : [];
  if (input.category === "Moda" && /masculin/i.test(input.offer.title)) {
    category = ["modamasculina", "lookdodia", "moda"];
  }
  const term = input.offer.searchTerm ? [slug(input.offer.searchTerm).replace(/\s+/g, "")] : [];
  const filler = pick(FILLER_TAGS, input.offer.productId, "tag");
  const all = [...new Set([...words, ...category.slice(0, 2), ...term, ...(input.tags ?? []), filler])];
  return all.slice(0, MAX_TAGS).map((tag) => `#${tag}`);
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
