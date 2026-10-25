/**
 * Vídeo vertical cartoon (1080x1920, 30 fps): um personagem vetorial testa o produto, aprova,
 * mostra o preço e chama pra ação. Narração via edge-tts com boca sincronizada ao áudio.
 *
 * Uso: tsx src/cartoon-video.ts <spec.json> [--still <segundos>]
 *   --still gera só um PNG do quadro no instante dado (pra conferir poses), sem áudio.
 */
import { execFile, spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";

const run = promisify(execFile);

const W = 1080;
const H = 1920;
const FPS = 30;
const FONT = "DejaVu Sans, Arial, Helvetica, sans-serif";
const BRAND = "#ee4d2d";
const BG = "#fff4f0";
const INK = "#1f1f1f";
const SKIN = "#f3c79a";
const SKIN_DARK = "#d9a26e";
const HAIR = "#3b2a20";
const SHIRT = "#1b1b1b";
const SHORTS = "#2f4f9e";

type Spec = {
  brand: string;
  title: string;
  price: number;
  originalPrice: number;
  discountPercent: number;
  hasVariantPrices?: boolean;
  image: string;
  logo?: string;
  python: string;
  voice: string;
  rate?: string;
  /** Quatro falas: testei/aprovei, benefícios, preço, chamada. */
  lines: [string, string, string, string];
  features: [string, string, string, string];
  out: string;
};

// ---------- utilidades de animação ----------
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const easeOutCubic = (t: number) => 1 - Math.pow(1 - clamp01(t), 3);
const easeInOutSine = (t: number) => -(Math.cos(Math.PI * clamp01(t)) - 1) / 2;
const easeOutBack = (t: number) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const x = clamp01(t);
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
};
/** Progresso 0..1 entre t0 e t0+dur. */
const seg = (t: number, t0: number, dur: number) => clamp01((t - t0) / dur);
const brl = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ---------- personagem ----------
type Hand = "open" | "fist" | "thumb" | "point" | "glove";
type Pose = {
  x: number;
  y: number;
  s: number;
  lean: number;
  bob: number;
  armL: [number, number];
  armR: [number, number];
  handL: Hand;
  handR: Hand;
  legL: [number, number];
  legR: [number, number];
  mouth: number;
  expr: "smile" | "grin" | "o" | "flat";
  eyes: "open" | "closed" | "wide" | "happy";
  brow: number;
  headTilt: number;
  shirt: "white" | "black";
  sweat: boolean;
};

const basePose = (): Pose => ({
  x: 540,
  y: 1560,
  s: 1,
  lean: 0,
  bob: 0,
  armL: [8, -6],
  armR: [8, -6],
  handL: "open",
  handR: "open",
  legL: [0, 0],
  legR: [0, 0],
  mouth: 0,
  expr: "smile",
  eyes: "open",
  brow: 0,
  headTilt: 0,
  shirt: "black",
  sweat: false,
});

const out = (w = 9) => `stroke="${INK}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"`;

function hand(kind: Hand, side: 1 | -1): string {
  // Desenhado na ponta do antebraço (origem na extremidade, eixo y apontando pra fora do braço).
  switch (kind) {
    case "fist":
      return `<circle cx="0" cy="22" r="36" fill="${SKIN}" ${out()}/><path d="M-20,8 q20,-10 40,0" fill="none" ${out(6)}/>`;
    case "thumb":
      return `<g transform="scale(${side},1)"><rect x="4" y="18" width="30" height="66" rx="15" fill="${SKIN}" ${out()}/><circle cx="0" cy="22" r="36" fill="${SKIN}" ${out()}/><rect x="6" y="20" width="22" height="34" fill="${SKIN}" stroke="none"/><path d="M-26,10 q26,-8 52,0" fill="none" ${out(6)}/></g>`;
    case "point":
      return `<rect x="-13" y="20" width="26" height="64" rx="13" fill="${SKIN}" ${out()}/><circle cx="0" cy="18" r="34" fill="${SKIN}" ${out()}/><rect x="-11" y="22" width="22" height="24" fill="${SKIN}" stroke="none"/>`;
    case "glove":
      return `<circle cx="0" cy="26" r="48" fill="${BRAND}" ${out()}/><path d="M-26,10 q26,-10 52,0" fill="none" stroke="#ffffff" stroke-width="7" stroke-linecap="round" opacity=".7"/>`;
    default:
      return `<ellipse cx="0" cy="22" rx="32" ry="40" fill="${SKIN}" ${out()}/><path d="M-18,20 v26 M0,24 v30 M18,20 v26" fill="none" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>`;
  }
}

function arm(side: 1 | -1, angles: [number, number], kind: Hand, shirt: string): string {
  // side = -1: braço da esquerda da tela. Ângulo positivo = braço sobe pra fora.
  const [sh, el] = angles;
  const sx = side * 150;
  const sy = -650;
  const rot = (a: number) => (side === -1 ? a : -a);
  return `
  <g transform="translate(${sx},${sy}) rotate(${rot(sh)})">
    <rect x="-36" y="-20" width="72" height="200" rx="36" fill="${shirt}" ${out()}/>
    <g transform="translate(0,185) rotate(${rot(el)})">
      <rect x="-30" y="-10" width="60" height="180" rx="30" fill="${SKIN}" ${out()}/>
      <g transform="translate(0,170)">${hand(kind, side)}</g>
    </g>
  </g>`;
}

function leg(side: 1 | -1, angles: [number, number]): string {
  const [hip, knee] = angles;
  const rot = (a: number) => (side === -1 ? a : -a);
  return `
  <g transform="translate(${side * 48},-440) rotate(${rot(hip)})">
    <rect x="-38" y="-20" width="76" height="230" rx="38" fill="${SKIN}" ${out()}/>
    <g transform="translate(0,205) rotate(${rot(-knee)})">
      <rect x="-32" y="-10" width="64" height="210" rx="32" fill="${SKIN}" ${out()}/>
      <g transform="translate(0,200)">
        <rect x="-70" y="-14" width="124" height="54" rx="27" fill="${BRAND}" ${out()}/>
        <rect x="-62" y="12" width="110" height="20" rx="10" fill="#ffffff" stroke="none"/>
      </g>
    </g>
  </g>`;
}

/** Posição da mão na tela, seguindo as mesmas transformações de arm(). */
function handPos(p: Pose, side: 1 | -1): [number, number] {
  const [sh, el] = side === -1 ? p.armL : p.armR;
  const rad = (a: number) => ((side === -1 ? a : -a) * Math.PI) / 180;
  const a1 = rad(sh);
  const a2 = rad(sh + el);
  const ex = -185 * Math.sin(a1);
  const ey = 185 * Math.cos(a1);
  const hx = ex - 192 * Math.sin(a2);
  const hy = ey + 192 * Math.cos(a2);
  // ponto no espaço do personagem (antes do bob/lean), origem nos pés
  return [p.x + p.s * (side * 150 + hx), p.y + p.s * (-650 + hy + p.bob)];
}

function bike(p: Pose, time: number): { under: string; over: string } {
  const [lx, ly] = handPos(p, -1);
  const [rx, ry] = handPos(p, 1);
  const cx = p.x;
  const wheelY = p.y - 150 * p.s;
  const spin = (time * 720) % 360;
  const under = `
  <g transform="translate(${cx},${wheelY}) scale(${p.s})">
    <ellipse cx="0" cy="0" rx="62" ry="160" fill="#ffffff" ${out(10)}/>
    <ellipse cx="0" cy="0" rx="36" ry="118" fill="none" stroke="#888" stroke-width="5" transform="rotate(${spin * 0.1})"/>
    <circle r="16" fill="${INK}"/>
    <path d="M-62,-120 q62,-70 124,0" fill="none" ${out(12)}/>
  </g>`;
  const over = `
  <g>
    <line x1="${cx}" y1="${wheelY - 150 * p.s}" x2="${cx}" y2="${(ly + ry) / 2}" stroke="${INK}" stroke-width="${16 * p.s}" stroke-linecap="round"/>
    <line x1="${lx - 70 * p.s}" y1="${ly}" x2="${rx + 70 * p.s}" y2="${ry}" stroke="${INK}" stroke-width="${22 * p.s}" stroke-linecap="round"/>
    <line x1="${lx - 70 * p.s}" y1="${ly}" x2="${lx - 10 * p.s}" y2="${ly}" stroke="${BRAND}" stroke-width="${22 * p.s}" stroke-linecap="round"/>
    <line x1="${rx + 10 * p.s}" y1="${ry}" x2="${rx + 70 * p.s}" y2="${ry}" stroke="${BRAND}" stroke-width="${22 * p.s}" stroke-linecap="round"/>
  </g>`;
  return { under, over };
}

function pow(x: number, y: number, k: number): string {
  if (k <= 0) return "";
  const pts: string[] = [];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const r = i % 2 === 0 ? 120 : 76;
    pts.push(`${Math.cos(a) * r},${Math.sin(a) * r}`);
  }
  return `<g transform="translate(${x},${y}) rotate(-10) scale(${easeOutBack(k)})">
    <polygon points="${pts.join(" ")}" fill="#ffc83d" ${out(8)}/>
    <text y="18" text-anchor="middle" font-family="${FONT}" font-size="54" font-weight="800" fill="${INK}">POW!</text>
  </g>`;
}

function face(p: Pose): string {
  const eyeY = -828;
  let eyes = "";
  for (const ex of [-44, 44]) {
    if (p.eyes === "closed") {
      eyes += `<path d="M${ex - 18},${eyeY + 4} q18,14 36,0" fill="none" ${out(7)}/>`;
    } else if (p.eyes === "happy") {
      eyes += `<path d="M${ex - 20},${eyeY + 6} q20,-26 40,0" fill="none" ${out(8)}/>`;
    } else {
      const r = p.eyes === "wide" ? 1.35 : 1;
      eyes += `<ellipse cx="${ex}" cy="${eyeY}" rx="${22 * r}" ry="${26 * r}" fill="#ffffff" ${out(6)}/>
      <circle cx="${ex + 4}" cy="${eyeY + 4}" r="${11 * r}" fill="${INK}"/>
      <circle cx="${ex + 8}" cy="${eyeY - 2}" r="4" fill="#ffffff"/>`;
    }
  }
  const browY = -878 - p.brow * 14;
  const brows = `<path d="M-68,${browY + 4} q24,-14 48,-4 M20,${browY} q24,-10 48,4" fill="none" ${out(9)}/>`;
  const my = -742;
  let mouth = "";
  const open = clamp01(p.mouth);
  if (p.expr === "o") {
    mouth = `<ellipse cx="0" cy="${my + 8}" rx="${22 + open * 8}" ry="${26 + open * 10}" fill="#6b1f1f" ${out(7)}/>`;
  } else if (open > 0.08) {
    const rx = p.expr === "grin" ? 52 : 40;
    const ry = 6 + open * (p.expr === "grin" ? 34 : 30);
    mouth = `<path d="M${-rx},${my} Q0,${my + ry * 2} ${rx},${my} Q0,${my + 2} ${-rx},${my} Z" fill="#6b1f1f" ${out(7)}/>
    <rect x="${-rx * 0.8}" y="${my - 3}" width="${rx * 1.6}" height="${Math.max(0, ry * 0.6)}" rx="4" fill="#ffffff" stroke="none"/>`;
  } else if (p.expr === "grin") {
    mouth = `<path d="M-52,${my - 4} Q0,${my + 46} 52,${my - 4} Q0,${my + 14} -52,${my - 4} Z" fill="#ffffff" ${out(7)}/>`;
  } else if (p.expr === "flat") {
    mouth = `<path d="M-28,${my + 6} h56" fill="none" ${out(8)}/>`;
  } else {
    mouth = `<path d="M-38,${my - 2} q38,36 76,0" fill="none" ${out(8)}/>`;
  }
  const blush = `<ellipse cx="-78" cy="-770" rx="18" ry="10" fill="#f09a86" opacity=".55"/><ellipse cx="78" cy="-770" rx="18" ry="10" fill="#f09a86" opacity=".55"/>`;
  const sweat = p.sweat
    ? `<path d="M112,-900 q22,34 0,52 q-22,-18 0,-52 z" fill="#7cc4ff" ${out(5)}/>`
    : "";
  return brows + eyes + mouth + blush + sweat;
}

function character(p: Pose, time: number): string {
  const shirt = p.shirt === "black" ? SHIRT : "#ffffff";
  const seam = p.shirt === "black" ? "#3d3d3d" : "#dddddd";
  const bob = p.bob + Math.sin(time * 2.4) * 4;
  return `
  <g transform="translate(${p.x},${p.y}) scale(${p.s})">
    <ellipse cx="0" cy="12" rx="${190}" ry="26" fill="#000" opacity=".12"/>
    <g transform="translate(0,${bob}) rotate(${p.lean} 0 -440)">
      ${leg(-1, p.legL)}
      ${leg(1, p.legR)}
      <path d="M-128,-452 L128,-452 L140,-290 L16,-290 L0,-330 L-16,-290 L-140,-290 Z" fill="${SHORTS}" ${out()}/>
      <rect x="-34" y="-720" width="68" height="80" rx="20" fill="${SKIN_DARK}" ${out()}/>
      <path d="M-156,-664 Q-172,-560 -128,-440 L128,-440 Q172,-560 156,-664 Q0,-700 -156,-664 Z" fill="${shirt}" ${out()}/>
      <path d="M-54,-668 Q-120,-620 -150,-560 M54,-668 Q120,-620 150,-560" fill="none" stroke="${seam}" stroke-width="5"/>
      <path d="M-120,-630 Q-150,-560 -118,-470" fill="none" stroke="#ffffff" stroke-width="10" opacity=".10"/>
      <ellipse cx="0" cy="-668" rx="54" ry="18" fill="${SKIN_DARK}" ${out(7)}/>
      ${arm(-1, p.armL, p.handL, shirt)}
      ${arm(1, p.armR, p.handR, shirt)}
      <g transform="rotate(${p.headTilt} 0 -700)">
        <circle cx="-118" cy="-800" r="24" fill="${SKIN}" ${out()}/>
        <circle cx="118" cy="-800" r="24" fill="${SKIN}" ${out()}/>
        <circle cx="0" cy="-805" r="128" fill="${SKIN}" ${out()}/>
        <path d="M-124,-840 Q-120,-930 -40,-940 Q10,-990 60,-940 Q120,-935 124,-840 Q90,-880 40,-870 Q-20,-895 -124,-840 Z" fill="${HAIR}" ${out()}/>
        ${face(p)}
      </g>
    </g>
  </g>`;
}

// ---------- cenas ----------
type Four = [number, number, number, number];
type Timeline = {
  intro: number;
  starts: Four;
  durs: Four;
  total: number;
};

type Scene = { pose: Pose; overlay: string; under: string };

function productCard(img: string, x: number, y: number, size: number, caption: string, rot = 0): string {
  return `
  <g transform="translate(${x},${y}) rotate(${rot})">
    <rect x="${-size / 2 - 6}" y="${-size / 2 + 10}" width="${size + 12}" height="${size + 12}" rx="36" fill="#000" opacity=".10"/>
    <rect x="${-size / 2}" y="${-size / 2}" width="${size}" height="${size}" rx="34" fill="#ffffff" ${out(8)}/>
    <image href="${img}" x="${-size / 2 + 18}" y="${-size / 2 + 18}" width="${size - 36}" height="${size - 36}" preserveAspectRatio="xMidYMid meet"/>
    ${caption ? `<text x="0" y="${size / 2 + 56}" text-anchor="middle" font-family="${FONT}" font-size="34" font-weight="700" fill="${INK}">${esc(caption)}</text>` : ""}
  </g>`;
}

function badge(x: number, y: number, pct: number, scale: number, rot = -12): string {
  if (scale <= 0) return "";
  return `
  <g transform="translate(${x},${y}) rotate(${rot}) scale(${scale})">
    <circle r="118" fill="${BRAND}" ${out(10)}/>
    <circle r="100" fill="none" stroke="#ffffff" stroke-width="6" stroke-dasharray="14 12"/>
    <text y="30" text-anchor="middle" font-family="${FONT}" font-size="86" font-weight="800" fill="#ffffff">-${pct}%</text>
  </g>`;
}

function bigText(lines: string[], y: number, size: number, fill: string, weight = 800, lineH = 1.15): string {
  return lines
    .map(
      (l, i) =>
        `<text x="540" y="${y + i * size * lineH}" text-anchor="middle" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="${fill}">${esc(l)}</text>`,
    )
    .join("");
}

function bubble(x: number, y: number, text: string, scale: number, tailSide: 1 | -1 = -1): string {
  if (scale <= 0) return "";
  const w = Math.max(220, text.length * 30 + 60);
  return `
  <g transform="translate(${x},${y}) scale(${scale})">
    <rect x="${-w / 2}" y="-56" width="${w}" height="112" rx="40" fill="#ffffff" ${out(8)}/>
    <path d="M${tailSide * 40},50 L${tailSide * 70},96 L${tailSide * 90},46 Z" fill="#ffffff" ${out(8)}/>
    <rect x="${tailSide * 36 - 20}" y="40" width="40" height="18" fill="#ffffff" stroke="none"/>
    <text y="18" text-anchor="middle" font-family="${FONT}" font-size="50" font-weight="800" fill="${INK}">${esc(text)}</text>
  </g>`;
}

function poof(x: number, y: number, k: number): string {
  if (k <= 0 || k >= 1) return "";
  const r = 40 + k * 260;
  const parts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const rr = r * (0.8 + 0.2 * Math.sin(i * 7));
    parts.push(`<circle cx="${x + Math.cos(a) * rr}" cy="${y + Math.sin(a) * rr}" r="${(1 - k) * 46}" fill="#ffffff" ${out(7)}/>`);
  }
  return `<g opacity="${1 - k * k}">${parts.join("")}</g>`;
}

function speedLines(x: number, y: number, time: number): string {
  let s = "";
  for (let i = 0; i < 5; i++) {
    const yy = y - 520 + i * 110;
    const off = ((time * 900 + i * 120) % 220) - 110;
    s += `<path d="M${x - 300 - off},${yy} h${110 + (i % 2) * 60}" stroke="${INK}" stroke-width="9" stroke-linecap="round" opacity=".55"/>`;
  }
  return s;
}

function icon(kind: string): string {
  switch (kind) {
    case "corrida":
      return `<circle cx="14" cy="-30" r="12" fill="${INK}"/><path d="M-4,-10 l22,10 l-14,24 l-16,10 M18,0 l20,8 M4,24 l18,16" fill="none" stroke="${INK}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>`;
    case "treino":
      return `<rect x="-34" y="-8" width="68" height="16" rx="6" fill="${INK}"/><rect x="-44" y="-24" width="16" height="48" rx="5" fill="${INK}"/><rect x="28" y="-24" width="16" height="48" rx="5" fill="${INK}"/>`;
    case "bike":
      return `<circle cx="-24" cy="12" r="20" fill="none" stroke="${INK}" stroke-width="8"/><circle cx="26" cy="12" r="20" fill="none" stroke="${INK}" stroke-width="8"/><path d="M-24,12 L0,-20 L26,12 M0,-20 L-8,12 M8,-30 h16" fill="none" stroke="${INK}" stroke-width="8" stroke-linecap="round"/>`;
    default:
      return `<path d="M-30,-6 q0,-30 20,-30 h14 q16,0 24,16 q10,20 -4,38 q-16,18 -36,12 q-22,-8 -18,-36 z" fill="${INK}"/><path d="M-30,-6 q-14,2 -14,16 q0,14 14,14" fill="${INK}"/>`;
  }
}

function chip(x: number, y: number, label: string, kind: string, k: number): string {
  if (k <= 0) return "";
  const s = easeOutBack(k);
  return `
  <g transform="translate(${x},${y}) scale(${s})">
    <rect x="-170" y="-62" width="340" height="124" rx="40" fill="#ffffff" ${out(8)}/>
    <g transform="translate(-112,0)">${icon(kind)}</g>
    <text x="40" y="16" text-anchor="middle" font-family="${FONT}" font-size="40" font-weight="800" fill="${INK}">${esc(label)}</text>
    <circle cx="144" cy="-54" r="30" fill="#2ecc71" ${out(7)}/>
    <path d="M130,-54 l10,10 l20,-22" fill="none" stroke="#ffffff" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
  </g>`;
}

function confetti(time: number, k: number): string {
  if (k <= 0) return "";
  const colors = [BRAND, "#ffc83d", "#2ecc71", "#3d8bff", "#ff6fae"];
  let s = "";
  for (let i = 0; i < 60; i++) {
    const seed = (i * 9301 + 49297) % 233280;
    const r = seed / 233280;
    const x = 40 + ((i * 137) % 1000);
    const speed = 500 + r * 500;
    const y = ((time * speed + r * 1900) % 2100) - 100;
    const rot = time * 300 + i * 40;
    s += `<rect x="${x}" y="${y}" width="22" height="34" rx="4" fill="${colors[i % colors.length]}" transform="rotate(${rot} ${x + 11} ${y + 17})" opacity="${0.9 * k}"/>`;
  }
  return s;
}

function priceCard(spec: Spec, k1: number, k2: number, k3: number, img: string): string {
  // k1: card entra, k2: preço novo bate, k3: selo gira.
  if (k1 <= 0) return "";
  const yIn = lerp(-900, 0, easeOutBack(k1));
  const prefix = spec.hasVariantPrices ? "a partir de" : "por";
  return `
  <g transform="translate(0,${yIn})">
    <rect x="80" y="150" width="920" height="1120" rx="56" fill="#000" opacity=".10" transform="translate(0,16)"/>
    <rect x="80" y="150" width="920" height="1120" rx="56" fill="#ffffff" ${out(10)}/>
    <image href="${img}" x="240" y="190" width="600" height="600" preserveAspectRatio="xMidYMid meet"/>
    <text x="540" y="870" text-anchor="middle" font-family="${FONT}" font-size="40" font-weight="700" fill="#555">${esc(spec.title)}</text>
    <text x="540" y="960" text-anchor="middle" font-family="${FONT}" font-size="56" font-weight="400" fill="#888">De R$ ${brl.format(spec.originalPrice)}</text>
    <line x1="330" y1="944" x2="750" y2="944" stroke="${BRAND}" stroke-width="8" stroke-linecap="round"/>
    ${
      k2 > 0
        ? `<g transform="translate(540,1130) scale(${easeOutBack(k2)})">
      <text y="-70" text-anchor="middle" font-family="${FONT}" font-size="40" font-weight="700" fill="#555">${prefix}</text>
      <text y="48" text-anchor="middle" font-family="${FONT}" font-size="124" font-weight="800" fill="${BRAND}">R$ ${brl.format(spec.price)}</text>
    </g>`
        : ""
    }
    ${badge(880, 240, spec.discountPercent, easeOutBack(k3), lerp(-380, -12, easeOutCubic(k3)))}
  </g>`;
}

function blinkEyes(time: number): boolean {
  const cycle = time % 3.3;
  return cycle > 3.1;
}

function scene(spec: Spec, tl: Timeline, t: number, mouth: number, img: string): Scene {
  const p = basePose();
  p.mouth = mouth;
  if (blinkEyes(t)) p.eyes = "closed";
  let overlay = "";
  let under = "";
  const [sA, sB, sC, sD] = tl.starts;
  const [dA, , dC, dD] = tl.durs;
  const header = `
    ${spec.logo ? `<image href="${spec.logo}" x="60" y="60" width="120" height="120"/>` : ""}
    <text x="${spec.logo ? 200 : 60}" y="146" font-family="${FONT}" font-size="60" font-weight="800" fill="${BRAND}">${esc(spec.brand.toUpperCase())}</text>`;

  if (t < sB - 0.2) {
    // ----- intro + cena A: veste, testa, aprova -----
    const poofT = 0.25;
    const a = t - sA;
    p.shirt = t < poofT + 0.12 ? "white" : "black";
    const k = seg(t, poofT, 0.55);
    under += poof(540, 1010, k);
    if (t < poofT + 0.12) {
      p.armL = [150, 20];
      p.armR = [150, 20];
      p.eyes = "closed";
      p.expr = "smile";
    } else {
      const settle = easeOutCubic(seg(t, poofT + 0.12, 0.45));
      // mão no peito enquanto fala
      p.armL = [lerp(150, -22, settle), lerp(20, -126, settle)];
      p.handL = "open";
      p.armR = [lerp(150, 10, settle), lerp(20, -8, settle)];
      p.headTilt = Math.sin(t * 3) * 3;
      const approve = easeOutBack(seg(a, dA - 1.1, 0.5));
      if (approve > 0) {
        p.armR = [lerp(10, 38, approve), lerp(-8, 138, approve)];
        p.handR = "thumb";
        p.expr = "grin";
        p.eyes = approve > 0.6 ? "happy" : p.eyes;
        p.brow = 1;
        overlay += bubble(250, 1060, "APROVEI!", approve, 1);
      }
    }
    const cardK = easeOutBack(seg(t, 0.05, 0.6));
    overlay += `<g transform="translate(${lerp(1500, 860, cardK)},430)">${productCard(img, 0, 0, 300, "", 6)}</g>`;
    overlay += badge(985, 275, spec.discountPercent, 0.8 * easeOutBack(seg(t, 0.5, 0.5)), -14);
    const titleK = easeOutCubic(seg(t, 0.15, 0.5));
    const title = ["TESTEI", "A CAMISA DE", "COMPRESSÃO"]
      .map((l, i) => `<text x="60" y="${330 + i * 100}" font-family="${FONT}" font-size="84" font-weight="800" fill="${INK}">${esc(l)}</text>`)
      .join("");
    overlay += `<g opacity="${titleK}" transform="translate(0,${lerp(40, 0, titleK)})">${title}</g>`;
    overlay += `<g opacity="${titleK}"><text x="60" y="610" font-family="${FONT}" font-size="46" font-weight="700" fill="#555">da Shopee, por R$ ${brl.format(spec.price)}</text></g>`;
  } else if (t < sC - 0.2) {
    // ----- cena B: benefícios + esportes -----
    const b = t - sB;
    p.s = 0.9;
    p.y = 1640;
    const showK = easeInOutSine(seg(b, 0, 0.6));
    const sports: Four = [1.9, 2.85, 3.8, 4.75];
    const idx = sports.findIndex((s0, i) => b >= s0 && (i === 3 || b < (sports[i + 1] ?? Infinity)));
    if (b < sports[0]) {
      // mostra o tecido: braços abertos, depois balança a camisa
      const wave = Math.sin(b * 9) * 6;
      p.armL = [lerp(8, 78, showK) + wave, lerp(-6, 10, showK)];
      p.armR = [lerp(8, 78, showK) - wave, lerp(-6, 10, showK)];
      p.sweat = b > 0.8;
      p.expr = "smile";
      p.brow = 0.5;
    } else if (idx === 0) {
      // corrida
      const ph = b * 2 * Math.PI * 2.4;
      p.legL = [Math.sin(ph) * 38, 30 + Math.max(0, Math.sin(ph)) * 50];
      p.legR = [-Math.sin(ph) * 38, 30 + Math.max(0, -Math.sin(ph)) * 50];
      p.armL = [-Math.sin(ph) * 42, -95];
      p.armR = [Math.sin(ph) * 42, -95];
      p.handL = p.handR = "fist";
      p.lean = -12;
      p.bob = -14 + Math.abs(Math.sin(ph)) * -18;
      p.expr = "grin";
      p.sweat = true;
      under += speedLines(540, 1560, t);
    } else if (idx === 1) {
      // treino: flexiona
      const f = easeOutBack(seg(b, sports[1], 0.4));
      p.armL = [lerp(8, 92, f), lerp(-6, 128, f)];
      p.armR = [lerp(8, 92, f), lerp(-6, 128, f)];
      p.handL = p.handR = "fist";
      p.expr = "grin";
      p.brow = 1;
      p.sweat = true;
    } else if (idx === 2) {
      // bike: inclinado, mãos à frente, pernas pedalando
      const ph = b * 2 * Math.PI * 2;
      p.lean = 0;
      p.armL = [55, -90];
      p.armR = [55, -90];
      p.handL = p.handR = "fist";
      p.legL = [Math.sin(ph) * 28, 40 + Math.cos(ph) * 25];
      p.legR = [-Math.sin(ph) * 28, 40 - Math.cos(ph) * 25];
      p.bob = -10;
      p.expr = "grin";
      const bk = bike(p, t);
      under += speedLines(540, 1640, t) + bk.under;
      overlay += bk.over;
    } else {
      // luta: guarda + jab
      const jab = Math.max(0, Math.sin((b - sports[3]) * 2 * Math.PI * 2.2));
      p.armL = [40, 150];
      p.armR = [lerp(40, 130, jab), lerp(150, 0, jab)];
      p.handL = p.handR = "glove";
      p.lean = lerp(0, -8, jab);
      p.legL = [10, 15];
      p.legR = [-12, 15];
      p.expr = "flat";
      p.brow = -0.5;
      p.eyes = p.eyes === "closed" ? "closed" : "wide";
      if (jab > 0.85) {
        const [hx, hy] = handPos(p, 1);
        overlay += pow(hx - 40, hy - 120, seg(jab, 0.85, 0.15));
      }
    }
    const headK = easeOutCubic(seg(b, 0, 0.4));
    overlay += `<g opacity="${headK}">${bigText(["LEVE E SECA RÁPIDO"], 300, 78, INK)}</g>`;
    const names: string[] = ["corrida", "treino", "bike", "luta"];
    const chipPos: [number, number][] = [
      [300, 430],
      [780, 430],
      [300, 570],
      [780, 570],
    ];
    for (let i = 0; i < 4; i++) {
      const [cx, cy] = chipPos[i] ?? [0, 0];
      overlay += chip(cx, cy, spec.features[i] ?? "", names[i] ?? "luta", seg(b, (sports[i] ?? 0) + 0.05, 0.45));
    }
  } else if (t < sD - 0.2) {
    // ----- cena C: preço -----
    const c = t - sC;
    p.x = 300;
    p.y = 1900;
    p.s = 0.62;
    const k1 = seg(c, 0, 0.7);
    const k2 = seg(c, dC * 0.36, 0.5);
    const k3 = seg(c, dC * 0.66, 0.5);
    overlay += priceCard(spec, k1, k2, k3, img);
    if (k2 <= 0) {
      p.armR = [150, 8];
      p.handR = "point";
      p.expr = "flat";
      p.brow = -0.3;
    } else if (k3 <= 0) {
      const sh = easeOutBack(k2);
      p.armL = [lerp(8, 150, sh), lerp(-6, 30, sh)];
      p.armR = [lerp(8, 150, sh), lerp(-6, 30, sh)];
      p.expr = "o";
      p.eyes = p.eyes === "closed" ? "closed" : "wide";
      p.brow = 1.2;
      p.bob = -lerp(0, 40, sh);
    } else {
      const th = easeOutBack(k3);
      p.armL = [lerp(150, 38, th), lerp(30, 138, th)];
      p.armR = [lerp(150, 38, th), lerp(30, 138, th)];
      p.handL = p.handR = "thumb";
      p.expr = "grin";
      p.eyes = "happy";
      p.brow = 1;
    }
  } else {
    // ----- cena D: chamada -----
    const d = t - sD;
    const k = easeOutBack(seg(d, 0, 0.6));
    p.y = 1760;
    p.armL = [38, 138];
    p.armR = [38, 138];
    p.handL = p.handR = "thumb";
    p.expr = d > dD ? "grin" : "smile";
    p.eyes = d > dD + 0.3 ? "happy" : p.eyes;
    p.brow = 1;
    p.headTilt = Math.sin(t * 4) * 4;
    under += confetti(t, clamp01(d * 2));
    overlay += `<g transform="translate(540,420) scale(${k})">
      <rect x="-470" y="-250" width="940" height="500" rx="60" fill="${BRAND}" ${out(10)}/>
      <text y="-110" text-anchor="middle" font-family="${FONT}" font-size="64" font-weight="700" fill="#ffffff">COMENTA</text>
      <text y="40" text-anchor="middle" font-family="${FONT}" font-size="150" font-weight="800" fill="#ffffff">EU QUERO</text>
      <text y="160" text-anchor="middle" font-family="${FONT}" font-size="54" font-weight="700" fill="#ffe9e3">que eu te mando o link</text>
    </g>`;
    overlay += `<g opacity="${easeOutCubic(seg(d, 0.5, 0.5))}">${bigText(["Link na bio"], 760, 58, "#555", 700)}</g>`;
  }
  return { pose: p, overlay: header + overlay, under };
}

function frameSvg(spec: Spec, tl: Timeline, t: number, mouth: number, img: string): string {
  const { pose, overlay, under } = scene(spec, tl, t, mouth, img);
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <radialGradient id="spot" cx="50%" cy="70%" r="70%">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset="1" stop-color="${BG}"/>
    </radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#spot)"/>
  <circle cx="540" cy="1250" r="620" fill="#ffe4da" opacity=".6"/>
  ${under}
  ${character(pose, t)}
  ${overlay}
</svg>`;
}

// ---------- áudio ----------
async function buildVoice(spec: Spec, dir: string): Promise<{ tl: Timeline; wav: string; mouth: Float32Array }> {
  const files: string[] = [];
  const durs: number[] = [];
  for (let i = 0; i < 4; i++) {
    const f = join(dir, `seg${i}.mp3`);
    await run(spec.python, ["-m", "edge_tts", "--voice", spec.voice, `--rate=${spec.rate ?? "+10%"}`, "--text", spec.lines[i] ?? "", "--write-media", f]);
    const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]);
    files.push(f);
    durs.push(Number.parseFloat(stdout.trim()));
  }
  const intro = 0.9;
  const gap = 0.45;
  const starts: number[] = [];
  let cursor = intro;
  for (let i = 0; i < 4; i++) {
    starts.push(cursor);
    cursor += (durs[i] ?? 0) + gap;
  }
  const total = cursor - gap + 1.6;
  const wav = join(dir, "voice.wav");
  const delays = files.map((_, i) => `[${i}]adelay=${Math.round((starts[i] ?? 0) * 1000)}|${Math.round((starts[i] ?? 0) * 1000)}[a${i}]`).join(";");
  const mix = files.map((_, i) => `[a${i}]`).join("") + `amix=inputs=4:normalize=0,apad=whole_dur=${total.toFixed(3)},atrim=0:${total.toFixed(3)}[a]`;
  await run("ffmpeg", ["-y", "-loglevel", "error", ...files.flatMap((f) => ["-i", f]), "-filter_complex", `${delays};${mix}`, "-map", "[a]", "-ar", "44100", wav]);

  // Energia por quadro pra animar a boca.
  const sr = 3000;
  const { stdout } = await run("ffmpeg", ["-loglevel", "error", "-i", wav, "-ac", "1", "-ar", String(sr), "-f", "f32le", "-"], {
    encoding: "buffer",
    maxBuffer: 1 << 26,
  });
  const samples = new Float32Array(stdout.buffer, stdout.byteOffset, stdout.byteLength / 4);
  const frames = Math.ceil(total * FPS);
  const per = sr / FPS;
  const raw = new Float32Array(frames);
  let max = 0;
  for (let f = 0; f < frames; f++) {
    let acc = 0;
    const a = Math.floor(f * per);
    const b = Math.min(samples.length, Math.floor((f + 1) * per));
    for (let i = a; i < b; i++) acc += (samples[i] ?? 0) ** 2;
    raw[f] = Math.sqrt(acc / Math.max(1, b - a));
    max = Math.max(max, raw[f] ?? 0);
  }
  const mouth = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    const v = (raw[f] ?? 0) / (max || 1);
    const prev = f > 0 ? (mouth[f - 1] ?? 0) : 0;
    const target = clamp01(Math.pow(v, 0.7) * 1.4);
    mouth[f] = target > prev ? target : lerp(prev, target, 0.55);
  }
  return { tl: { intro, starts: starts as Four, durs: durs as Four, total }, wav, mouth };
}

// ---------- render ----------
function dataUri(path: string): string {
  const buf = readFileSync(path);
  const mime = path.endsWith(".png") ? "image/png" : "image/jpeg";
  return `data:${mime};base64,${buf.toString("base64")}`;
}

async function renderFrame(svg: string): Promise<Buffer> {
  return sharp(Buffer.from(svg)).flatten({ background: BG }).removeAlpha().raw().toBuffer();
}

async function main() {
  const [specPath, flag, flagValue] = process.argv.slice(2);
  if (!specPath) throw new Error("uso: cartoon-video.ts <spec.json> [--still <segundos>]");
  const specDir = dirname(resolve(specPath));
  const spec = JSON.parse(readFileSync(specPath, "utf8")) as Spec;
  const abs = (p: string) => resolve(specDir, p);
  const img = dataUri(abs(spec.image));
  const logo = spec.logo ? dataUri(abs(spec.logo)) : undefined;
  const outPath = abs(spec.out);
  mkdirSync(dirname(outPath), { recursive: true });
  const work = join(dirname(outPath), "work");
  mkdirSync(work, { recursive: true });
  const fullSpec: Spec = { ...spec, python: abs(spec.python) };
  if (logo) fullSpec.logo = logo;

  if (flag === "--still") {
    const t = Number.parseFloat(flagValue ?? "0");
    const tl: Timeline = { intro: 0.9, starts: [0.9, 6.1, 12.3, 20.0], durs: [4.7, 5.8, 7.2, 2.7], total: 24.3 };
    const png = outPath.replace(/\.mp4$/, `-${t.toFixed(2)}.png`);
    await sharp(Buffer.from(frameSvg(fullSpec, tl, t, 0.6, img))).flatten({ background: BG }).png().toFile(png);
    console.log(png);
    return;
  }

  const { tl, wav, mouth } = await buildVoice(fullSpec, work);
  const frames = Math.ceil(tl.total * FPS);
  console.log(`[cartoon] ${frames} quadros, ${tl.total.toFixed(1)}s; falas em ${tl.starts.map((s) => s.toFixed(1)).join(", ")}`);

  const ff = spawn(
    "ffmpeg",
    [
      "-y", "-loglevel", "error",
      "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", `${W}x${H}`, "-r", String(FPS), "-i", "-",
      "-i", wav,
      "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "160k", "-shortest", "-movflags", "+faststart",
      outPath,
    ],
    { stdio: ["pipe", "inherit", "inherit"] },
  );
  const done = new Promise<void>((res, rej) => {
    ff.on("close", (code) => (code === 0 ? res() : rej(new Error(`ffmpeg saiu com ${code}`))));
  });

  const BATCH = 6;
  for (let f = 0; f < frames; f += BATCH) {
    const bufs = await Promise.all(
      Array.from({ length: Math.min(BATCH, frames - f) }, (_, i) => renderFrame(frameSvg(fullSpec, tl, (f + i) / FPS, mouth[f + i] ?? 0, img))),
    );
    for (const b of bufs) {
      if (!ff.stdin.write(b)) await new Promise((r) => ff.stdin.once("drain", r));
    }
    if (f % 120 === 0) process.stdout.write(`[cartoon] ${Math.round((f / frames) * 100)}%\r`);
  }
  ff.stdin.end();
  await done;
  writeFileSync(join(dirname(outPath), "timeline.json"), JSON.stringify(tl, null, 2));
  console.log(`\n[cartoon] pronto: ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
