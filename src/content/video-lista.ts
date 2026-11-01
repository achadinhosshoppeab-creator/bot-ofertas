/**
 * Formato "lista": "5 achadinhos abaixo de R$ 30". Gancho forte, um produto por vez com número,
 * preço estourando e barra de progresso, final pedindo comentário com o número e salvamento.
 * A narração é gerada por trecho e cada segmento dura exatamente o que a fala dura.
 */
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import { shortTitle } from "../publishers/format.js";
import type { Offer } from "../sources/types.js";
import { SLIDE_HEIGHT as H, SLIDE_WIDTH as W, wrapLines } from "./carousel.js";
import { spokenTitle, synthesize, type TtsOptions } from "./video.js";
import {
  brl,
  clamp01,
  easeOutBack,
  easeOutCubic,
  FPS,
  rand,
  span,
  text,
} from "./video3d.js";

const run = promisify(execFile);

export type ListaItem = {
  offer: Offer;
  referencePrice: number;
  discountPercent: number;
};

export type ListaInput = {
  items: ListaItem[];
  /** Ex.: 30 → "abaixo de R$ 30". */
  maxPrice: number;
  brand: string;
  telegram?: string;
};

type Segment = {
  kind: "hook" | "item" | "end";
  index: number;
  start: number;
  duration: number;
};

/** Paleta que muda a cada item para manter o olho preso. */
const PALETTES = [
  ["#ff5a3c", "#ff9a3c"],
  ["#ff3cac", "#784ba0"],
  ["#2bd2ff", "#2b6cff"],
  ["#ffd23c", "#ff7a3c"],
  ["#43e97b", "#38f9d7"],
  ["#f5576c", "#f093fb"],
];

const numberSpoken = [
  "um",
  "dois",
  "três",
  "quatro",
  "cinco",
  "seis",
  "sete",
  "oito",
];
const SPOKEN_STOP = new Set([
  "com",
  "para",
  "de",
  "da",
  "do",
  "e",
  "em",
  "pp",
  "un",
  "kit",
  "novo",
  "nova",
  "the",
]);

/** Nome falado curto (até 4 palavras, sem números nem códigos): "fita led super ultra". */
export function shortSpoken(title: string): string {
  const firstPart = title.split(/\s[-–|/+]\s|[!:;,()[\]|+]/)[0] ?? title;
  return firstPart
    .replace(/[*#"']+/g, " ")
    .split(/\s+/)
    .filter(
      (w) =>
        w &&
        !/\d/.test(w) &&
        w.length > 2 &&
        !SPOKEN_STOP.has(w.toLowerCase()) &&
        !/^[A-Z0-9-]{5,}$/.test(w),
    )
    .slice(0, 4)
    .join(" ")
    .toLowerCase();
}

export function listaScripts(input: ListaInput): {
  hook: string;
  items: string[];
  end: string;
} {
  const n = input.items.length;
  return {
    hook: `${numberSpoken[n - 1] ?? n} achadinhos abaixo de ${input.maxPrice} reais. Olha só!`,
    items: input.items.map((item, i) => {
      const reais = Math.floor(item.offer.price);
      const centavos = Math.round((item.offer.price - reais) * 100);
      const price = centavos > 0 ? `${reais} e ${centavos}` : `${reais} reais`;
      const name =
        shortSpoken(item.offer.title) || spokenTitle(item.offer.title);
      const openers = ["Número", "O", "E o"];
      const opener = openers[i % openers.length];
      return opener === "Número"
        ? `Número ${numberSpoken[i] ?? i + 1}: ${name}, por ${price}.`
        : `${opener} ${numberSpoken[i] ?? i + 1}, ${name}, por ${price}.`;
    }),
    end: "Comenta o número que você quer, que eu te mando o link. E salva o vídeo!",
  };
}

function hookFrame(input: ListaInput, t: number, dur: number): string {
  const n = input.items.length;
  const pop = easeOutBack(span(t, 0, 0.5));
  const pop2 = easeOutBack(span(t, 0.35, 0.85));
  const pop3 = easeOutCubic(span(t, 0.7, 1.1));
  const shake = t < 0.5 ? Math.sin(t * 60) * 3 : 0;
  const zoom = 1 + 0.06 * (t / dur);
  const blobs = Array.from({ length: 7 }, (_, i) => {
    const [a, b] = PALETTES[i % PALETTES.length] as [string, string];
    const x =
      120 + rand(i) * (W - 240) + 40 * Math.sin(t * (0.8 + rand(i + 9)) + i);
    const y =
      200 +
      rand(i + 20) * (H - 400) +
      40 * Math.cos(t * (0.7 + rand(i + 30)) + i);
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(180 + rand(i + 40) * 160).toFixed(0)}" fill="${i % 2 ? a : b}" opacity="0.28"/>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="100%" height="100%" fill="#120a1f"/>
  ${blobs}
  <g transform="translate(${W / 2} ${H / 2}) scale(${zoom.toFixed(4)}) rotate(${shake.toFixed(2)}) translate(${-W / 2} ${-H / 2})">
    <g transform="translate(${W / 2} 760) scale(${pop.toFixed(3)})">
      ${text(String(n), 0, 60, 330, "#ffe14d", 900)}
    </g>
    <g transform="translate(${W / 2} 950) scale(${pop2.toFixed(3)})">
      ${text("ACHADINHOS", 0, 0, 118, "#ffffff", 900)}
    </g>
    <g opacity="${pop3.toFixed(3)}" transform="translate(0 ${((1 - pop3) * 40).toFixed(1)})">
      <rect x="${W / 2 - 390}" y="1030" width="780" height="120" rx="60" fill="#ff3cac"/>
      ${text(`abaixo de R$ ${input.maxPrice}`, W / 2, 1112, 70, "#ffffff", 900)}
      ${text("que valem MUITO a pena", W / 2, 1260, 56, "#ffe14d", 800)}
    </g>
  </g>
  ${text(input.brand.toUpperCase(), W / 2, 150, 42, "#ffffff", 800, 'letter-spacing="10" opacity="0.8"')}
</svg>`;
}

/** Fundo do segmento anterior (para a transição de círculo que abre). */
function previousBackground(index: number): string {
  if (index <= 0) return `<rect width="100%" height="100%" fill="#120a1f"/>`;
  const [p1, p2] = PALETTES[(index - 1) % PALETTES.length] as [string, string];
  return `<defs><linearGradient id="gp" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${p1}"/><stop offset="1" stop-color="${p2}"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#gp)"/><rect width="100%" height="100%" fill="#000" opacity="0.18"/>`;
}

function itemFrame(
  input: ListaInput,
  index: number,
  imageUri: string,
  t: number,
  dur: number,
): string {
  const wipe = easeOutCubic(span(t, 0, 0.32));
  const item = input.items[index] as ListaItem;
  const n = input.items.length;
  const [c1, c2] = PALETTES[index % PALETTES.length] as [string, string];
  const fromLeft = index % 2 === 0;
  const enter = easeOutBack(span(t, 0, 0.45));
  const slideX = (1 - enter) * (fromLeft ? -W : W);
  const kb = 1 + 0.07 * (t / dur);
  const badge = easeOutBack(span(t, 0.15, 0.55));
  const pricePop = easeOutBack(span(t, 0.45, 0.85));
  const pricePulse = t > 0.85 ? 1 + 0.03 * Math.sin((t - 0.85) * 9) : 1;
  const titleIn = easeOutCubic(span(t, 0.35, 0.7));
  const tagIn = easeOutBack(span(t, 0.6, 0.95));
  const exit = 1 - easeOutCubic(span(t, dur - 0.22, dur));
  const imgSize = 800;
  const imgX = W / 2 - imgSize / 2;
  const imgY = 330;
  const lines = wrapLines(shortTitle(item.offer.title, 56), 24, 2);
  const segs = Array.from({ length: n }, (_, i) => {
    const w = (W - 120 - (n - 1) * 10) / n;
    const x = 60 + i * (w + 10);
    const fill = i < index ? 1 : i === index ? clamp01(t / dur) : 0;
    return `<rect x="${x.toFixed(1)}" y="60" width="${w.toFixed(1)}" height="10" rx="5" fill="#ffffff" opacity="0.3"/><rect x="${x.toFixed(1)}" y="60" width="${(w * fill).toFixed(1)}" height="10" rx="5" fill="#ffffff"/>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient>
    <clipPath id="ic"><rect x="${imgX}" y="${imgY}" width="${imgSize}" height="${imgSize}" rx="48"/></clipPath>
  </defs>
  ${previousBackground(index)}
  <clipPath id="wipe"><circle cx="${W / 2}" cy="${H / 2}" r="${(wipe * 1250).toFixed(1)}"/></clipPath>
  <g clip-path="url(#wipe)">
    <rect width="100%" height="100%" fill="url(#g)"/>
    <rect width="100%" height="100%" fill="#000" opacity="${(0.18 + 0.12 * (1 - exit)).toFixed(3)}"/>
  </g>
  ${wipe < 1 ? `<circle cx="${W / 2}" cy="${H / 2}" r="${(wipe * 1250).toFixed(1)}" fill="none" stroke="#ffffff" stroke-width="14" opacity="${(1 - wipe).toFixed(2)}"/>` : ""}
  ${segs}
  ${text(input.brand.toUpperCase(), W / 2, 150, 38, "#ffffff", 800, 'letter-spacing="10" opacity="0.85"')}

  <g transform="translate(${slideX.toFixed(1)} 0)" opacity="${exit.toFixed(3)}">
    <rect x="${imgX + 14}" y="${imgY + 22}" width="${imgSize}" height="${imgSize}" rx="48" fill="#000" opacity="0.3"/>
    <rect x="${imgX}" y="${imgY}" width="${imgSize}" height="${imgSize}" rx="48" fill="#ffffff"/>
    <g clip-path="url(#ic)">
      <g transform="translate(${W / 2} ${imgY + imgSize / 2}) scale(${kb.toFixed(4)}) translate(${-W / 2} ${-(imgY + imgSize / 2)})">
        <image href="${imageUri}" x="${imgX + 20}" y="${imgY + 20}" width="${imgSize - 40}" height="${imgSize - 40}" preserveAspectRatio="xMidYMid meet"/>
      </g>
    </g>
  </g>

  <g transform="translate(${imgX + 10} ${imgY + 10}) scale(${badge.toFixed(3)})">
    <circle r="92" fill="#120a1f" stroke="#ffffff" stroke-width="8"/>
    ${text(String(index + 1), 0, 42, 110, "#ffe14d", 900)}
  </g>

  <g transform="translate(${imgX + imgSize - 30} ${imgY + 40}) rotate(12) scale(${tagIn.toFixed(3)})">
    <rect x="-130" y="-46" width="260" height="92" rx="20" fill="#ffe14d"/>
    ${text(`-${Math.round(item.discountPercent)}%`, 0, 24, 66, "#120a1f", 900)}
  </g>

  <g opacity="${titleIn.toFixed(3)}" transform="translate(0 ${((1 - titleIn) * 30).toFixed(1)})">
    ${lines.map((line, i) => text(line, W / 2, 1245 + i * 74, 60, "#ffffff", 800)).join("")}
  </g>

  <g transform="translate(${W / 2} 1560) scale(${(pricePop * pricePulse).toFixed(4)})">
    <rect x="-400" y="-110" width="800" height="220" rx="110" fill="#ffffff"/>
    ${text(`era R$ ${brl.format(item.referencePrice)}`, -120, -40, 38, "#777777", 600)}
    <line x1="-260" y1="-52" x2="20" y2="-52" stroke="#999999" stroke-width="5" stroke-linecap="round"/>
    ${text(`R$ ${brl.format(item.offer.price)}`, 0, 62, 120, "#e8431f", 900)}
    ${item.offer.hasVariantPrices ? text("a partir de", 230, -40, 32, "#777777", 600) : ""}
  </g>
  ${index === n - 1 ? "" : text("próximo ›", W / 2, 1800, 40, "#ffffff", 700, 'opacity="0.75"')}
</svg>`;
}

function endFrame(input: ListaInput, t: number): string {
  const wipe = easeOutCubic(span(t, 0, 0.32));
  const pop = easeOutBack(span(t, 0, 0.5));
  const pop2 = easeOutBack(span(t, 0.4, 0.9));
  const pop3 = easeOutCubic(span(t, 0.9, 1.3));
  const pulse = 1 + 0.03 * Math.sin(t * 7);
  const channel = input.telegram ? `t.me/${input.telegram}` : "";
  const nums = input.items
    .map(
      (_, i) =>
        `<g transform="translate(${W / 2 + (i - (input.items.length - 1) / 2) * 150} 1130) scale(${easeOutBack(span(t, 0.5 + i * 0.08, 0.9 + i * 0.08)).toFixed(3)})"><circle r="56" fill="#ffe14d"/>${text(String(i + 1), 0, 24, 64, "#120a1f", 900)}</g>`,
    )
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  ${previousBackground(input.items.length)}
  <clipPath id="wipeEnd"><circle cx="${W / 2}" cy="${H / 2}" r="${(wipe * 1250).toFixed(1)}"/></clipPath>
  <g clip-path="url(#wipeEnd)"><rect width="100%" height="100%" fill="#120a1f"/></g>
  <circle cx="${W / 2}" cy="900" r="${(700 * pop).toFixed(0)}" fill="#ff3cac" opacity="0.25"/>
  ${text(input.brand.toUpperCase(), W / 2, 150, 42, "#ffffff", 800, 'letter-spacing="10" opacity="0.8"')}
  <g transform="translate(${W / 2} 760) scale(${(pop * pulse).toFixed(4)})">
    ${text("Comenta o", 0, -160, 76, "#ffffff", 800)}
    ${text("NÚMERO", 0, 10, 150, "#ffe14d", 900)}
    ${text("do que você quer", 0, 120, 70, "#ffffff", 800)}
  </g>
  ${nums}
  <g transform="translate(${W / 2} 1330) scale(${pop2.toFixed(3)})">
    ${text("que eu te mando o link", 0, 0, 58, "#ffffff", 700)}
  </g>
  <g opacity="${pop3.toFixed(3)}">
    <rect x="${W / 2 - 330}" y="1440" width="660" height="110" rx="55" fill="#ffffff"/>
    ${text("Salva pra não perder", W / 2, 1512, 50, "#120a1f", 900)}
    ${channel ? text(channel, W / 2, 1660, 44, "#ffe14d", 800) : ""}
  </g>
</svg>`;
}

/** Gera o vídeo lista; retorna a duração em segundos. */
export async function buildListaVideo(
  input: ListaInput,
  images: Buffer[],
  outPath: string,
  tts: TtsOptions | undefined,
  log = console.log,
): Promise<number> {
  const work = mkdtempSync(join(tmpdir(), "lista-"));
  try {
    const uris = await Promise.all(
      images.map(
        async (img) =>
          `data:image/jpeg;base64,${(await sharp(img).resize(820, 820, { fit: "inside" }).jpeg({ quality: 90 }).toBuffer()).toString("base64")}`,
      ),
    );
    const scripts = listaScripts(input);
    const parts = [scripts.hook, ...scripts.items, scripts.end];
    const minDur = [1.8, ...input.items.map(() => 2.2), 3.0];
    const audio: string[] = [];
    const durations: number[] = [];
    for (const [i, part] of parts.entries()) {
      const file = join(work, `voz${i}.mp3`);
      const seconds = tts ? await synthesize(part, file, tts) : 0;
      durations.push(Math.max(minDur[i] as number, seconds + 0.25));
      if (tts) audio.push(file);
    }
    const segments: Segment[] = [];
    let cursor = 0;
    durations.forEach((duration, i) => {
      const kind = i === 0 ? "hook" : i === parts.length - 1 ? "end" : "item";
      segments.push({ kind, index: i - 1, start: cursor, duration });
      cursor += duration;
    });
    const total = cursor;
    const frames = Math.round(total * FPS);
    log(
      `[lista] ${input.items.length} itens, ${frames} quadros (${total.toFixed(1)}s)`,
    );

    const BATCH = 6;
    for (let start = 0; start < frames; start += BATCH) {
      await Promise.all(
        Array.from({ length: Math.min(BATCH, frames - start) }, (_, k) => {
          const n = start + k;
          const t = n / FPS;
          const seg =
            segments.find((s) => t >= s.start && t < s.start + s.duration) ??
            (segments.at(-1) as Segment);
          const local = t - seg.start;
          const svg =
            seg.kind === "hook"
              ? hookFrame(input, local, seg.duration)
              : seg.kind === "end"
                ? endFrame(input, local)
                : itemFrame(
                    input,
                    seg.index,
                    uris[seg.index] as string,
                    local,
                    seg.duration,
                  );
          return sharp(Buffer.from(svg))
            .png({ compressionLevel: 3 })
            .toFile(join(work, `f${String(n).padStart(5, "0")}.png`));
        }),
      );
    }

    const args = [
      "-y",
      "-framerate",
      String(FPS),
      "-i",
      join(work, "f%05d.png"),
    ];
    if (audio.length > 0) {
      // Cada fala preenchida com silêncio até a duração do seu segmento, depois concatenadas.
      const padded: string[] = [];
      for (const [i, file] of audio.entries()) {
        const out = join(work, `pad${i}.wav`);
        await run("ffmpeg", [
          "-y",
          "-i",
          file,
          "-af",
          `apad=whole_dur=${(durations[i] as number).toFixed(3)}`,
          "-t",
          (durations[i] as number).toFixed(3),
          "-ar",
          "44100",
          "-ac",
          "2",
          out,
        ]);
        padded.push(out);
      }
      const list = join(work, "list.txt");
      writeFileSync(list, padded.map((p) => `file '${p}'`).join("\n"));
      const voice = join(work, "voz.wav");
      await run("ffmpeg", [
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        list,
        "-c",
        "copy",
        voice,
      ]);
      args.push("-i", voice, "-c:a", "aac", "-b:a", "160k");
    }
    args.push(
      "-t",
      total.toFixed(3),
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-crf",
      "17",
      "-preset",
      "medium",
      "-movflags",
      "+faststart",
      outPath,
    );
    await run("ffmpeg", args, { maxBuffer: 16 * 1024 * 1024 });
    return total;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** Só para testes: um quadro isolado. */
export async function renderListaFramePng(
  input: ListaInput,
  images: Buffer[],
  kind: "hook" | "item" | "end",
  index: number,
  t: number,
): Promise<Buffer> {
  const uris = await Promise.all(
    images.map(
      async (img) =>
        `data:image/jpeg;base64,${(await sharp(img).resize(820, 820, { fit: "inside" }).jpeg({ quality: 90 }).toBuffer()).toString("base64")}`,
    ),
  );
  const svg =
    kind === "hook"
      ? hookFrame(input, t, 2.5)
      : kind === "end"
        ? endFrame(input, t)
        : itemFrame(input, index, uris[index] as string, t, 2.6);
  return sharp(Buffer.from(svg)).png().toBuffer();
}
