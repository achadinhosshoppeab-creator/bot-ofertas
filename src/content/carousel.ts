import sharp from "sharp";
import { escapeHtml, shortTitle } from "../publishers/format.js";
import type { Offer } from "../sources/types.js";

export const SLIDE_WIDTH = 1080;
export const SLIDE_HEIGHT = 1920;
const FONT = "Arial, Helvetica, sans-serif";

const brl = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export type CarouselInput = {
  offer: Offer;
  referencePrice: number;
  discountPercent: number;
  brand: string;
};

export type ImageFetcher = (url: string) => Promise<Buffer>;

export const fetchImage: ImageFetcher = async (url) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Falha ao baixar imagem (${response.status}): ${url}`);
  }
  return Buffer.from(await response.arrayBuffer());
};

/** Quebra o título em até `maxLines` linhas de até `maxChars` caracteres. */
export function wrapLines(text: string, maxChars: number, maxLines: number): string[] {
  const lines: string[] = [];
  let current = "";
  for (const word of text.split(/\s+/)) {
    if (current && (current + " " + word).length > maxChars) {
      lines.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) {
    lines.push(current);
  }
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines - 1);
    kept.push(`${lines.slice(maxLines - 1).join(" ").slice(0, maxChars - 1).trimEnd()}…`);
    return kept;
  }
  return lines;
}

function svgText(lines: string[], options: { y: number; size: number; weight?: number; fill: string; lineHeight?: number }): string {
  const lineHeight = options.lineHeight ?? options.size * 1.2;
  return lines
    .map(
      (line, index) =>
        `<text x="540" y="${options.y + index * lineHeight}" text-anchor="middle" font-family="${FONT}" font-size="${options.size}" font-weight="${options.weight ?? 400}" fill="${options.fill}">${escapeHtml(line)}</text>`,
    )
    .join("");
}

function frame(content: string, background = "#fff4f0"): Buffer {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SLIDE_WIDTH}" height="${SLIDE_HEIGHT}">
      <rect width="100%" height="100%" fill="${background}"/>
      ${content}
    </svg>`,
  );
}

/** Slide 1: foto do produto grande, selo de desconto e preço. */
export async function productSlide(input: CarouselInput, image: Buffer): Promise<Buffer> {
  const photo = await sharp(image)
    .resize(900, 900, { fit: "contain", background: "#ffffff" })
    .png()
    .toBuffer();

  const base = frame(`
    ${svgText([input.brand.toUpperCase()], { y: 140, size: 44, weight: 800, fill: "#ee4d2d" })}
    <rect x="90" y="220" width="900" height="900" rx="48" fill="#ffffff"/>
    ${svgText(wrapLines(shortTitle(input.offer.title, 80), 26, 2), { y: 1250, size: 54, weight: 700, fill: "#222222" })}
    ${svgText([`De R$ ${brl.format(input.referencePrice)}`], { y: 1450, size: 48, fill: "#777777" })}
    <line x1="340" y1="1436" x2="740" y2="1436" stroke="#777777" stroke-width="5"/>
    ${svgText([`${input.offer.hasVariantPrices ? "a partir de " : "por "}R$ ${brl.format(input.offer.price)}`], { y: 1580, size: 96, weight: 800, fill: "#ee4d2d" })}
    ${svgText(["Comenta EU QUERO 💬"], { y: 1760, size: 52, weight: 700, fill: "#222222" })}
  `);

  const badgeSize = 250;
  const badge = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${badgeSize}" height="${badgeSize}">
      <circle cx="125" cy="125" r="115" fill="#ee4d2d" stroke="#fff4f0" stroke-width="10"/>
      <text x="125" y="152" text-anchor="middle" font-family="${FONT}" font-size="76" font-weight="800" fill="#ffffff">-${Math.round(input.discountPercent)}%</text>
    </svg>`,
  );

  return sharp(base)
    .composite([
      { input: photo, left: 90, top: 220 },
      { input: badge, left: SLIDE_WIDTH - badgeSize - 20, top: 130 },
    ])
    .jpeg({ quality: 90 })
    .toBuffer();
}

/** Slide 2: chamada para o canal (link da bio). */
export async function ctaSlide(input: CarouselInput): Promise<Buffer> {
  const overlay = frame(
    `
    ${svgText([input.brand.toUpperCase()], { y: 560, size: 56, weight: 800, fill: "#ee4d2d" })}
    ${svgText(wrapLines("Todas as ofertas do dia estão no nosso canal", 22, 3), { y: 760, size: 72, weight: 700, fill: "#222222" })}
    ${svgText(["É só clicar no link da bio 👆"], { y: 1080, size: 54, fill: "#444444" })}
  `,
    "#ffffff",
  );
  return sharp(overlay).jpeg({ quality: 90 }).toBuffer();
}

export async function buildCarousel(input: CarouselInput, fetcher: ImageFetcher = fetchImage): Promise<Buffer[]> {
  if (!input.offer.imageUrl) {
    throw new Error("Oferta sem imagem");
  }
  const image = await fetcher(input.offer.imageUrl);
  return [await productSlide(input, image), await ctaSlide(input)];
}
