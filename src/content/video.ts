import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import type { Offer } from "../sources/types.js";

const run = promisify(execFile);

const FPS = 30;
const MIN_PRODUCT_SECONDS = 6;
const CTA_SECONDS = 3;

export type VideoInput = {
  offer: Offer;
  discountPercent: number;
  brand: string;
};

export type TtsOptions =
  | {
      /** Vozes neurais da Microsoft via `edge-tts` (pt-BR-FranciscaNeural, pt-BR-AntonioNeural, pt-BR-ThalitaMultilingualNeural). */
      engine: "edge";
      python: string;
      voice: string;
      /** Ex.: "+8%". */
      rate?: string;
    }
  | {
      engine: "kokoro";
      /** Pasta do modelo Kokoro (model.onnx, voices.bin, tokens.txt, espeak-ng-data). */
      modelDir: string;
      python: string;
      speakerId?: number;
    };

const brlSpoken = (value: number): string => {
  const reais = Math.floor(value);
  const centavos = Math.round((value - reais) * 100);
  return centavos > 0 ? `${reais} reais e ${centavos} centavos` : `${reais} reais`;
};

/** Nome falável do produto: só o primeiro trecho do título, sem códigos e com poucas palavras. */
export function spokenTitle(title: string): string {
  const firstPart = title.split(/\s[-–|/]\s|[!:;,()[\]]/)[0] ?? title;
  const words = firstPart
    .replace(/[*#"']+/g, " ")
    .split(/\s+/)
    .filter((word) => word && !/^(?=.*[\d-])[A-Z0-9-]{5,}$/.test(word)) // tira códigos tipo "TGT-DVR-RGB02"
    .slice(0, 7);
  return words.join(" ").toLowerCase();
}

/** Texto curto que a voz fala por cima do vídeo. */
export function spokenScript(input: VideoInput): string {
  const title = spokenTitle(input.offer.title);
  const price = `${input.offer.hasVariantPrices ? "a partir de " : "por "}${brlSpoken(input.offer.price)}`;
  return `Olha esse achadinho: ${title}, ${price}, com ${Math.round(input.discountPercent)} por cento de desconto. Comenta eu quero que eu te mando o link.`;
}

async function mediaSeconds(path: string): Promise<number> {
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path]);
  return Number.parseFloat(stdout.trim());
}

/** Gera o áudio da narração (WAV no Kokoro, MP3 no Edge); retorna a duração em segundos. */
const EDGE_FALLBACK_VOICE = "pt-BR-FranciscaNeural";

export async function synthesize(text: string, outPath: string, tts: TtsOptions): Promise<number> {
  if (tts.engine === "edge") {
    const speak = (voice: string) =>
      run(tts.python, ["-m", "edge_tts", "--voice", voice, `--rate=${tts.rate ?? "+8%"}`, "--text", text, "--write-media", outPath]);
    try {
      await speak(tts.voice);
    } catch (error) {
      // O serviço às vezes recusa uma voz (ex.: "No audio was received"); tenta de novo e cai para a voz padrão.
      console.warn(`[tts] voz ${tts.voice} falhou (${String(error).split("\n")[0]}); tentando de novo...`);
      try {
        await speak(tts.voice);
      } catch {
        if (tts.voice === EDGE_FALLBACK_VOICE) throw error;
        console.warn(`[tts] usando ${EDGE_FALLBACK_VOICE}`);
        await speak(EDGE_FALLBACK_VOICE);
      }
    }
    return mediaSeconds(outPath);
  }
  const script = resolve("tools", "tts.py");
  const { stdout } = await run(tts.python, [script, tts.modelDir, text, outPath, String(tts.speakerId ?? 43)]);
  return Number.parseFloat(stdout.trim());
}

/**
 * Monta o vídeo vertical: slide do produto com zoom lento + narração, depois o slide de chamada.
 * Sem `tts`, o vídeo sai mudo (para colocar música no próprio TikTok).
 */
export async function buildVideo(
  input: VideoInput,
  slides: [Buffer, Buffer],
  outPath: string,
  tts?: TtsOptions,
): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "bot-ofertas-video-"));
  try {
    const slide1 = join(dir, "slide1.jpg");
    const slide2 = join(dir, "slide2.jpg");
    writeFileSync(slide1, slides[0]);
    writeFileSync(slide2, slides[1]);

    let voicePath: string | undefined;
    let productSeconds = MIN_PRODUCT_SECONDS;
    if (tts) {
      voicePath = join(dir, tts.engine === "edge" ? "voice.mp3" : "voice.wav");
      const seconds = await synthesize(spokenScript(input), voicePath, tts);
      productSeconds = Math.max(MIN_PRODUCT_SECONDS, Math.ceil(seconds + 0.8));
    }

    const productFrames = productSeconds * FPS;
    // Zoom lento sem zoompan (que treme por arredondar pixel): a imagem é ampliada 4x, reescalada
    // frame a frame com lanczos e recortada no centro, e só no fim reduzida para 1080x1920.
    const big = { w: 4320, h: 7680 };
    const zoom = [
      `loop=loop=${productFrames}:size=1:start=0`,
      `fps=${FPS}`,
      `format=rgb24`,
      `scale=w='trunc(${big.w}*(1+0.04*n/${productFrames}))':h=-1:eval=frame:flags=lanczos`,
      `crop=${big.w}:${big.h}:(iw-${big.w})/2:(ih-${big.h})/2`,
      `scale=1080:1920:flags=lanczos`,
      `trim=duration=${productSeconds}`,
      `setpts=PTS-STARTPTS`,
    ].join(",");
    const filter = [
      `[0:v]${zoom},format=yuv420p[v0]`,
      `[1:v]loop=loop=${CTA_SECONDS * FPS}:size=1:start=0,fps=${FPS},format=yuv420p,trim=duration=${CTA_SECONDS}[v1]`,
      `[v0][v1]concat=n=2:v=1:a=0[v]`,
    ].join(";");

    const args = ["-y", "-loglevel", "error", "-i", slide1, "-i", slide2];
    if (voicePath) {
      args.push("-i", voicePath);
    }
    args.push("-filter_complex", filter, "-map", "[v]");
    if (voicePath) {
      args.push("-map", "2:a", "-c:a", "aac", "-b:a", "128k", "-af", "apad", "-shortest");
    }
    args.push("-c:v", "libx264", "-preset", "medium", "-crf", "22", "-r", String(FPS), "-movflags", "+faststart", outPath);

    await run("ffmpeg", args);
    // Garante que o arquivo foi escrito.
    readFileSync(outPath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
