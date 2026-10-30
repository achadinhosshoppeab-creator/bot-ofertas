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

export type VideoStyle = "classic" | "neon";

export type Video3dInput = VideoInput & {
  referencePrice: number;
  /** Username do canal (sem @), mostrado na chamada final. */
  telegram?: string;
  /** Visual: "classic" (cartão laranja) ou "neon" (gancho, flip, etiqueta balançando, barra de preço caindo, confete). */
  style?: VideoStyle;
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

function renderFrameClassic(scene: Scene, t: number): string {
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


// ============================ estilo NEON ============================
function renderFrameNeon(scene: Scene, t: number): string {
  const { input, total, ctaAt } = scene;
  const cx = W / 2;

  // gancho inicial "PARA TUDO!" (0–1.3 s): estoura, treme e some
  const hookIn = easeOutBack(span(t, 0, 0.35));
  const hookOut = 1 - span(t, 0.95, 1.2);
  const hookScale = hookIn * (0.6 + 0.4 * hookOut);
  const hookRot = Math.sin(t * 40) * 2.5 * (t < 0.95 ? 1 : 0);
  const hookOpacity = t < 1.2 ? hookOut : 0;

  // cartão de vidro: flip no eixo X (deitado → em pé), depois flutua com giro leve em Y
  const flip = easeOutBack(span(t, 1.2, 2.0));
  const angleX = (1 - flip) * 85;
  const sy = Math.max(0.02, Math.cos((angleX * Math.PI) / 180));
  const wob = t > 2.0 ? 1 : 0;
  const angleY = wob * 6 * Math.sin((t - 2.0) * 1.6);
  const sx = Math.cos((angleY * Math.PI) / 180);
  const skew = Math.sin((angleY * Math.PI) / 180) * 4;
  const floatY = wob * 12 * Math.sin((t - 2.0) * 2.1);
  const cardW = 760;
  const cardH = 760;
  const cardX = cx - cardW / 2;
  const cardY = 330 + floatY;
  const cardCY = cardY + cardH / 2;
  const cardT = `translate(${cx} ${cardCY}) scale(${sx.toFixed(4)} ${sy.toFixed(4)}) skewY(${skew.toFixed(3)}) translate(${-cx} ${-cardCY})`;
  const ringPulse = 1 + 0.05 * Math.sin(t * 3);

  // etiqueta pendurada balançando (amortecida)
  const tagIn = easeOutBack(span(t, 2.2, 2.7));
  const swing = tagIn * 22 * Math.sin((t - 2.2) * 4.2) * Math.exp(-(Math.max(0, t - 2.2)) * 0.55) + tagIn * 4 * Math.sin((t - 2.2) * 2.4);
  const tagX = cardX + cardW - 40;
  const tagY = cardY - 20;

  // título
  const titleIn = easeOutCubic(span(t, 2.0, 2.5));
  const titleLines = wrapLines(shortTitle(input.offer.title, 60), 22, 2);

  // barra de preço caindo + contagem + confete
  const barIn = easeOutCubic(span(t, 2.6, 3.1));
  const drop = easeOutCubic(span(t, 3.1, 4.2));
  const shown = input.referencePrice + (input.offer.price - input.referencePrice) * drop;
  const done = t >= 4.2;
  const hit = done ? 1 + 0.12 * Math.exp(-(t - 4.2) * 4) * Math.cos((t - 4.2) * 30) : 1;
  const barX = 120;
  const barW = W - 240;
  const barY = 1440;
  const confetti: string[] = [];
  if (done && t < 4.2 + 2.6) {
    const age = t - 4.2;
    for (let i = 0; i < 60; i++) {
      const a = rand(i) * Math.PI * 2;
      const v = 380 + rand(i + 50) * 620;
      const x = cx + Math.cos(a) * v * age * 0.9;
      const y = 1520 + Math.sin(a) * v * age * 0.6 + 700 * age * age;
      const rot = rand(i + 150) * 360 + age * 500 * (rand(i + 250) - 0.5);
      const colors = ["#ffe14d", "#39f0ff", "#ff4dd2", "#7cff6b", "#ffffff"];
      const color = colors[i % colors.length];
      const op = clamp01(1 - age / 2.4);
      confetti.push(`<rect x="-9" y="-5" width="18" height="10" fill="${color}" opacity="${op.toFixed(2)}" transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${rot.toFixed(1)})"/>`);
    }
  }

  // chamada final digitada
  const ctaIn = easeOutBack(span(t, ctaAt, ctaAt + 0.5));
  const ctaText = "Comenta EU QUERO";
  const typed = ctaText.slice(0, Math.round(ctaText.length * span(t, ctaAt + 0.2, ctaAt + 1.1)));
  const cursor = t < ctaAt + 1.3 && Math.floor(t * 4) % 2 === 0 ? "|" : "";
  const channel = input.telegram ? `t.me/${input.telegram}` : "";

  // feixes de luz no fundo
  const beam1 = -200 + ((t * 90) % (W + 600));
  const beam2 = W + 200 - ((t * 60) % (W + 600));

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="nbg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0a0f2e"/><stop offset="0.5" stop-color="#2a0a4e"/><stop offset="1" stop-color="#071f33"/>
    </linearGradient>
    <linearGradient id="beam" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#39f0ff" stop-opacity="0"/><stop offset="0.5" stop-color="#39f0ff" stop-opacity="0.16"/><stop offset="1" stop-color="#39f0ff" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="beam2" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#ff4dd2" stop-opacity="0"/><stop offset="0.5" stop-color="#ff4dd2" stop-opacity="0.14"/><stop offset="1" stop-color="#ff4dd2" stop-opacity="0"/>
    </linearGradient>
    <radialGradient id="ring"><stop offset="0.55" stop-color="#39f0ff" stop-opacity="0"/><stop offset="0.8" stop-color="#39f0ff" stop-opacity="0.55"/><stop offset="1" stop-color="#ff4dd2" stop-opacity="0"/></radialGradient>
    <linearGradient id="glass" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity="0.22"/><stop offset="1" stop-color="#ffffff" stop-opacity="0.06"/></linearGradient>
    <linearGradient id="tag" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe14d"/><stop offset="1" stop-color="#ffb800"/></linearGradient>
    <linearGradient id="bar" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ff4dd2"/><stop offset="1" stop-color="#39f0ff"/></linearGradient>
    <linearGradient id="ncta" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#39f0ff"/><stop offset="1" stop-color="#ff4dd2"/></linearGradient>
    <clipPath id="imgClip"><rect x="${cardX + 30}" y="${cardY + 30}" width="${cardW - 60}" height="${cardH - 60}" rx="40"/></clipPath>
  </defs>

  <rect width="100%" height="100%" fill="url(#nbg)"/>
  <rect x="${beam1.toFixed(1)}" y="-400" width="420" height="${H + 800}" fill="url(#beam)" transform="rotate(18 ${cx} ${H / 2})"/>
  <rect x="${beam2.toFixed(1)}" y="-400" width="360" height="${H + 800}" fill="url(#beam2)" transform="rotate(-14 ${cx} ${H / 2})"/>
  ${Array.from({ length: 48 }, (_, i) => `<circle cx="${(i % 8) * 140 + 70}" cy="${Math.floor(i / 8) * 320 + 160}" r="2" fill="#ffffff" opacity="${(0.08 + 0.08 * Math.sin(t * 2 + i)).toFixed(3)}"/>`).join("")}

  ${text(input.brand.toUpperCase(), cx, 140, 42, "#9fe9ff", 800, 'letter-spacing="10"')}

  <circle cx="${cx}" cy="${cardCY.toFixed(1)}" r="${(520 * ringPulse * flip).toFixed(1)}" fill="url(#ring)"/>
  <g transform="${cardT}">
    <rect x="${cardX}" y="${cardY}" width="${cardW}" height="${cardH}" rx="52" fill="url(#glass)" stroke="#ffffff" stroke-opacity="0.55" stroke-width="3"/>
    <rect x="${cardX + 30}" y="${cardY + 30}" width="${cardW - 60}" height="${cardH - 60}" rx="40" fill="#ffffff"/>
    <image href="${scene.imageDataUri}" x="${cardX + 30}" y="${cardY + 30}" width="${cardW - 60}" height="${cardH - 60}" preserveAspectRatio="xMidYMid meet" clip-path="url(#imgClip)"/>
  </g>

  <g transform="translate(${tagX} ${tagY}) rotate(${swing.toFixed(2)}) scale(${tagIn.toFixed(3)})">
    <line x1="0" y1="-60" x2="0" y2="0" stroke="#ffffff" stroke-width="4" stroke-opacity="0.7"/>
    <path d="M-70 0 L70 0 L95 40 L70 190 Q70 210 50 210 L-50 210 Q-70 210 -70 190 L-95 40 Z" fill="url(#tag)" stroke="#fff6c2" stroke-width="5"/>
    <circle cx="0" cy="40" r="12" fill="#2a0a4e"/>
    ${text(`-${Math.round(input.discountPercent)}%`, 0, 150, 64, "#2a0a4e", 900)}
  </g>

  <g opacity="${titleIn.toFixed(3)}" transform="translate(${((titleIn - 1) * 140).toFixed(1)} 0)">
    <rect x="100" y="1180" width="10" height="${titleLines.length * 72 + 10}" rx="5" fill="#39f0ff"/>
    ${titleLines.map((line, i) => `<text x="140" y="${1236 + i * 72}" font-family="${FONT}" font-size="58" font-weight="800" fill="#ffffff">${esc(line)}</text>`).join("")}
  </g>

  <g opacity="${barIn.toFixed(3)}">
    ${text(`era R$ ${brl.format(input.referencePrice)}`, barX + 8, barY - 24, 40, "#c9b6ff", 600, 'text-anchor="start"')}
    <rect x="${barX}" y="${barY}" width="${barW}" height="26" rx="13" fill="#ffffff" fill-opacity="0.12"/>
    <rect x="${barX}" y="${barY}" width="${(barW * (1 - 0.82 * drop)).toFixed(1)}" height="26" rx="13" fill="url(#bar)"/>
    <circle cx="${(barX + barW * (1 - 0.82 * drop)).toFixed(1)}" cy="${barY + 13}" r="${(22 * hit).toFixed(1)}" fill="#ffffff"/>
  </g>
  <g transform="translate(${cx} 1610) scale(${(barIn * hit).toFixed(4)})">
    ${text(input.offer.hasVariantPrices ? "a partir de" : "agora", -250, -20, 40, "#9fe9ff", 700, 'text-anchor="end"')}
    ${text(`R$ ${brl.format(shown)}`, 60, 20, 128, done ? "#ffe14d" : "#ffffff", 900)}
  </g>
  ${confetti.join("")}

  <g transform="translate(${cx} ${(1765 + (1 - ctaIn) * 300).toFixed(1)}) scale(${ctaIn.toFixed(3)})">
    <rect x="-430" y="-68" width="860" height="136" rx="68" fill="#0a0f2e" stroke="url(#ncta)" stroke-width="8"/>
    ${text(`${typed}${cursor}`, 0, 24, 66, "#ffffff", 900)}
  </g>
  ${channel && ctaIn > 0 ? text(channel, cx, 1890, 38, "#9fe9ff", 700, `opacity="${ctaIn.toFixed(3)}"`) : ""}
  ${hookOpacity > 0 ? `<g transform="translate(${cx} 960) rotate(${hookRot.toFixed(2)}) scale(${hookScale.toFixed(3)})" opacity="${hookOpacity.toFixed(3)}"><rect x="-470" y="-150" width="940" height="300" rx="40" fill="#0a0f2e" opacity="0.75"/>${text("PARA TUDO!", 0, 44, 132, "#ffe14d", 900)}</g>` : ""}
  ${t > total - 0.4 ? `<rect width="100%" height="100%" fill="#000" opacity="${span(t, total - 0.4, total).toFixed(3)}"/>` : ""}
</svg>`;
}

function renderFrame(scene: Scene, t: number): string {
  return scene.input.style === "neon" ? renderFrameNeon(scene, t) : renderFrameClassic(scene, t);
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

