/**
 * Vídeo "3D" caprichado de uma oferta: cartão do produto girando em perspectiva, sombra e brilho
 * que acompanham o giro, selo de desconto que estoura, preço contando, faíscas e chamada final.
 * Cada quadro é um SVG renderizado pelo sharp; o ffmpeg junta com a narração.
 */
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import { shortTitle } from "../publishers/format.js";
import { SLIDE_HEIGHT as H, SLIDE_WIDTH as W, wrapLines } from "./carousel.js";
import { spokenTitle, synthesize, type TtsOptions, type VideoInput } from "./video.js";

const run = promisify(execFile);
const FPS = 30;
const FONT = "Arial, Helvetica, sans-serif";
const brl = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export type Video3dInput = VideoInput & {
  referencePrice: number;
  /** Username do canal (sem @), mostrado na chamada final. */
  telegram?: string;
};

// ---------- utilidades de animação ----------
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
/** Progresso 0..1 entre `from` e `to` segundos. */
const span = (t: number, from: number, to: number) => clamp01((t - from) / (to - from));
const easeOutCubic = (x: number) => 1 - Math.pow(1 - x, 3);
const easeOutBack = (x: number) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
};
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** Pseudo-aleatório determinístico (as faíscas ficam iguais a cada render). */
const rand = (seed: number) => {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
};

function text(content: string, x: number, y: number, size: number, fill: string, weight = 700, extra = ""): string {
  const anchor = extra.includes("text-anchor=") ? "" : 'text-anchor="middle"';
  return `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="${fill}" ${anchor} ${extra}>${esc(content)}</text>`;
}

/** Narração mais enérgica que a dos rascunhos comuns. */
export function hotScript(input: Video3dInput): string {
  const title = spokenTitle(input.offer.title);
  const reais = Math.floor(input.offer.price);
  const centavos = Math.round((input.offer.price - reais) * 100);
  const price = centavos > 0 ? `${reais} reais e ${centavos} centavos` : `${reais} reais`;
  return `Para tudo! ${title} ${input.offer.hasVariantPrices ? "a partir de" : "por"} ${price}, ${Math.round(input.discountPercent)} por cento de desconto. Esse tá voando. Comenta eu quero que eu te mando o link.`;
}

type Scene = {
  input: Video3dInput;
  imageDataUri: string;
  total: number;
  ctaAt: number;
};

function renderFrame(scene: Scene, t: number): string {
  const { input, total, ctaAt } = scene;
  const cx = W / 2;

  // --- entrada do cartão: sobe do fundo com giro de -40° → 0 (overshoot), depois flutua e balança em 3D
  const enter = easeOutBack(span(t, 0, 0.9));
  const wobble = t > 0.9 ? 1 : 0;
  const angle = (1 - enter) * -40 + wobble * 9 * Math.sin((t - 0.9) * 1.4); // graus, giro no eixo Y
  const rad = (angle * Math.PI) / 180;
  const sx = Math.cos(rad); // largura aparente
  const skew = Math.sin(rad) * 6; // leve inclinação das bordas = perspectiva
  const floatY = wobble * 14 * Math.sin((t - 0.9) * 1.9);
  const cardW = 820;
  const cardH = 820;
  const cardX = cx - cardW / 2;
  const cardY = 300 + (1 - enter) * 500 + floatY;
  const cardCY = cardY + cardH / 2;
  const scale = 0.6 + 0.4 * enter;
  const cardTransform = `translate(${cx} ${cardCY}) scale(${(scale * sx).toFixed(4)} ${scale.toFixed(4)}) skewY(${skew.toFixed(3)}) translate(${-cx} ${-cardCY})`;

  // sombra no "chão", deslocada para o lado oposto do giro
  const shadowW = cardW * 0.75 * Math.abs(sx) * scale + 60;
  const shadowX = cx - Math.sin(rad) * 90;
  const shadowY = cardY + cardH * scale + 70;
  const shadowOpacity = 0.55 * enter;

  // brilho (reflexo) que atravessa o cartão a cada 3 s
  const sweep = ((t - 1.2) % 3) / 3;
  const sweepX = cardX - 500 + sweep * (cardW + 1000);

  // --- selo de desconto
  const badge = easeOutBack(span(t, 0.9, 1.4));
  const badgePulse = 1 + 0.04 * Math.sin(t * 6);
  const badgeScale = badge * (t > 1.4 ? badgePulse : 1);

  // --- textos
  const titleIn = easeOutCubic(span(t, 1.3, 1.8));
  const refIn = easeOutCubic(span(t, 1.9, 2.3));
  const priceIn = easeOutBack(span(t, 2.3, 2.9));
  const count = easeOutCubic(span(t, 2.3, 3.1));
  const shownPrice = input.referencePrice + (input.offer.price - input.referencePrice) * count;
  const pricePulse = t > 3.1 ? 1 + 0.03 * Math.sin((t - 3.1) * 5) : 1;

  // --- chamada final
  const cta = easeOutBack(span(t, ctaAt, ctaAt + 0.6));
  const ctaPulse = 1 + 0.035 * Math.sin((t - ctaAt) * 7);

  // --- fundo: gradiente + dois focos de luz em paralaxe
  const glow1X = cx + 260 * Math.sin(t * 0.35);
  const glow1Y = 420 + 120 * Math.cos(t * 0.27);
  const glow2X = cx - 300 * Math.sin(t * 0.22 + 1);
  const glow2Y = 1500 + 100 * Math.sin(t * 0.31);

  // --- faíscas subindo
  const sparks: string[] = [];
  for (let i = 0; i < 34; i++) {
    const period = 2.6 + rand(i) * 2.2;
    const phase = ((t * 0.9 + rand(i + 100) * period) % period) / period;
    const x = 60 + rand(i + 200) * (W - 120);
    const y = H - phase * (H + 100);
    const size = 5 + rand(i + 300) * 9;
    const alpha = Math.sin(phase * Math.PI) * (0.35 + 0.65 * rand(i + 400)) * clamp01(span(t, 0.8, 1.6));
    const tw = 0.6 + 0.4 * Math.sin(t * (6 + rand(i + 500) * 6) + i);
    const s = size * tw;
    sparks.push(`<path d="M${x} ${y - s} Q${x} ${y} ${x + s} ${y} Q${x} ${y} ${x} ${y + s} Q${x} ${y} ${x - s} ${y} Q${x} ${y} ${x} ${y - s}Z" fill="#ffe3b0" opacity="${alpha.toFixed(3)}"/>`);
  }

  const titleLines = wrapLines(shortTitle(input.offer.title, 64), 24, 2);
  const discount = `-${Math.round(input.discountPercent)}%`;
  const pricePrefix = input.offer.hasVariantPrices ? "a partir de" : "por";
  const channel = input.telegram ? `t.me/${input.telegram}` : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2a0b06"/><stop offset="0.55" stop-color="#5a1408"/><stop offset="1" stop-color="#1a0604"/>
    </linearGradient>
    <radialGradient id="glow1"><stop offset="0" stop-color="#ff7a45" stop-opacity="0.75"/><stop offset="1" stop-color="#ff7a45" stop-opacity="0"/></radialGradient>
    <radialGradient id="glow2"><stop offset="0" stop-color="#ffb347" stop-opacity="0.45"/><stop offset="1" stop-color="#ffb347" stop-opacity="0"/></radialGradient>
    <radialGradient id="shadow"><stop offset="0" stop-color="#000" stop-opacity="0.8"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
    <linearGradient id="sheen" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="0.5" stop-color="#fff" stop-opacity="0.42"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="cardEdge" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#ffd9cc"/>
    </linearGradient>
    <linearGradient id="badge" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff6a3d"/><stop offset="1" stop-color="#d8301a"/></linearGradient>
    <linearGradient id="cta" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff7a45"/><stop offset="1" stop-color="#e8431f"/></linearGradient>
    <clipPath id="cardClip"><rect x="${cardX}" y="${cardY}" width="${cardW}" height="${cardH}" rx="56"/></clipPath>
  </defs>

  <rect width="100%" height="100%" fill="url(#bg)"/>
  <ellipse cx="${glow1X.toFixed(1)}" cy="${glow1Y.toFixed(1)}" rx="620" ry="520" fill="url(#glow1)"/>
  <ellipse cx="${glow2X.toFixed(1)}" cy="${glow2Y.toFixed(1)}" rx="560" ry="420" fill="url(#glow2)"/>
  ${sparks.join("")}

  ${text(input.brand.toUpperCase(), cx, 150, 46, "#ffd2c2", 800, 'letter-spacing="8"')}

  <ellipse cx="${shadowX.toFixed(1)}" cy="${shadowY.toFixed(1)}" rx="${(shadowW / 2).toFixed(1)}" ry="46" fill="url(#shadow)" opacity="${shadowOpacity.toFixed(3)}"/>

  <g transform="${cardTransform}">
    <rect x="${cardX - 10}" y="${cardY - 10}" width="${cardW + 20}" height="${cardH + 20}" rx="64" fill="url(#cardEdge)" opacity="0.9"/>
    <rect x="${cardX}" y="${cardY}" width="${cardW}" height="${cardH}" rx="56" fill="#ffffff"/>
    <image href="${scene.imageDataUri}" x="${cardX + 40}" y="${cardY + 40}" width="${cardW - 80}" height="${cardH - 80}" preserveAspectRatio="xMidYMid meet"/>
    <g clip-path="url(#cardClip)">
      <rect x="${sweepX.toFixed(1)}" y="${cardY - 200}" width="260" height="${cardH + 400}" fill="url(#sheen)" transform="skewX(-22)"/>
    </g>
  </g>

  <g transform="translate(${cx + 330} ${cardY + 20}) scale(${badgeScale.toFixed(4)})">
    <circle r="128" fill="#2a0b06" opacity="0.35" cx="10" cy="14"/>
    <circle r="128" fill="url(#badge)" stroke="#fff3ee" stroke-width="12"/>
    ${text(discount, 0, 34, 86, "#ffffff", 900)}
  </g>

  <g opacity="${titleIn.toFixed(3)}" transform="translate(${((1 - titleIn) * 120).toFixed(1)} 0)">
    ${titleLines.map((line, i) => text(line, cx, 1250 + i * 76, 60, "#ffffff", 800)).join("")}
  </g>

  <g opacity="${refIn.toFixed(3)}">
    ${text(`De R$ ${brl.format(input.referencePrice)}`, cx, 1430, 52, "#ffb8a3", 500)}
    <line x1="${cx - 150 * refIn}" y1="1414" x2="${cx + 150 * refIn}" y2="1414" stroke="#ff8a6a" stroke-width="7" stroke-linecap="round"/>
  </g>

  <g transform="translate(${cx} 1580) scale(${(priceIn * pricePulse).toFixed(4)})">
    ${text(pricePrefix, -230, -10, 40, "#ffd2c2", 600, 'text-anchor="end"')}
    ${text(`R$ ${brl.format(shownPrice)}`, 90, 20, 124, "#ffffff", 900)}
  </g>

  <g transform="translate(${cx} ${(1780 + (1 - cta) * 400).toFixed(1)}) scale(${(cta > 0 ? ctaPulse : 0).toFixed(4)})">
    <rect x="-420" y="-80" width="840" height="160" rx="80" fill="url(#cta)" stroke="#ffd9cc" stroke-width="6"/>
    ${text("Comenta EU QUERO", 0, 22, 66, "#ffffff", 900)}
  </g>
  ${channel && cta > 0 ? text(channel, cx, 1895, 42, "#ffd2c2", 700, `opacity="${cta.toFixed(3)}"`) : ""}
  ${t > total - 0.4 ? `<rect width="100%" height="100%" fill="#000" opacity="${span(t, total - 0.4, total).toFixed(3)}"/>` : ""}
</svg>`;
}

/** Renderiza o vídeo 3D com narração. Retorna a duração em segundos. */
export async function buildVideo3d(input: Video3dInput, image: Buffer, outPath: string, tts: TtsOptions | undefined, log = console.log): Promise<number> {
  const work = mkdtempSync(join(tmpdir(), "video3d-"));
  try {
    // Imagem do produto preparada uma vez (JPEG 900px) e embutida em cada quadro.
    const jpeg = await sharp(image).resize(900, 900, { fit: "inside", withoutEnlargement: false }).jpeg({ quality: 92 }).toBuffer();
    const imageDataUri = `data:image/jpeg;base64,${jpeg.toString("base64")}`;

    let audioSeconds = 0;
    const audioPath = join(work, "voz.mp3");
    if (tts) {
      audioSeconds = await synthesize(hotScript(input), audioPath, tts);
    }
    const total = Math.max(12, Math.ceil(audioSeconds + 1.2));
    const ctaAt = Math.max(5, total - 4.2);
    const scene: Scene = { input, imageDataUri, total, ctaAt };

    const frames = Math.round(total * FPS);
    log(`[video3d] ${frames} quadros (${total}s)`);
    const BATCH = 6;
    for (let start = 0; start < frames; start += BATCH) {
      await Promise.all(
        Array.from({ length: Math.min(BATCH, frames - start) }, (_, k) => {
          const n = start + k;
          const svg = renderFrame(scene, n / FPS);
          return sharp(Buffer.from(svg)).png({ compressionLevel: 3 }).toFile(join(work, `f${String(n).padStart(5, "0")}.png`));
        }),
      );
    }

    const args = ["-y", "-framerate", String(FPS), "-i", join(work, "f%05d.png")];
    if (tts) {
      args.push("-i", audioPath, "-af", "apad", "-c:a", "aac", "-b:a", "160k");
    }
    args.push("-t", String(total), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "17", "-preset", "medium", "-movflags", "+faststart", outPath);
    await run("ffmpeg", args, { maxBuffer: 16 * 1024 * 1024 });
    return total;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** Só para testes: um quadro isolado em PNG. */
export async function renderFramePng(input: Video3dInput, image: Buffer, t: number, total = 12): Promise<Buffer> {
  const jpeg = await sharp(image).resize(900, 900, { fit: "inside" }).jpeg({ quality: 92 }).toBuffer();
  const svg = renderFrame({ input, imageDataUri: `data:image/jpeg;base64,${jpeg.toString("base64")}`, total, ctaAt: total - 4.2 }, t);
  return sharp(Buffer.from(svg)).png().toBuffer();
}

