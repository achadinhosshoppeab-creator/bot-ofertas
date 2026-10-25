import sharp from "sharp";

const BRAND_COLOR = "#ee4d2d";

/** Logo quadrado (sacola branca em fundo laranja), pensado para corte circular de foto de perfil. */
export function logoSvg(size: number, brand: string, withText = true): string {
  const text = withText
    ? `<text x="540" y="930" text-anchor="middle" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-weight="800" font-size="118" fill="#ffffff" letter-spacing="2">${brand}</text>`
    : "";
  const bagY = withText ? 0 : 90;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1080 1080">
  <rect width="1080" height="1080" fill="${BRAND_COLOR}"/>
  <g transform="translate(0 ${bagY})">
    <rect x="300" y="360" width="480" height="420" rx="56" fill="#ffffff"/>
    <path d="M400 420 V330 a140 140 0 0 1 280 0 V420" fill="none" stroke="#ffffff" stroke-width="44" stroke-linecap="round"/>
    <circle cx="400" cy="430" r="26" fill="${BRAND_COLOR}"/>
    <circle cx="680" cy="430" r="26" fill="${BRAND_COLOR}"/>
    <path d="M440 650 h200" stroke="${BRAND_COLOR}" stroke-width="30" stroke-linecap="round"/>
    <text x="540" y="590" text-anchor="middle" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-weight="900" font-size="150" fill="${BRAND_COLOR}">%</text>
  </g>
  ${text}
</svg>`.replace(/\n\s*/g, "");
}

export async function renderLogo(path: string, size: number, brand: string, withText = true): Promise<void> {
  await sharp(Buffer.from(logoSvg(1080, brand, withText))).resize(size, size).png().toFile(path);
}
