/**
 * Fluxo completo para o vídeo de demonstração exigido na revisão do TikTok (Content Posting API):
 * login → dados do criador → escolha do vídeo e legenda → privacidade → interações →
 * conteúdo comercial → consentimento → publicação com status. Grave a tela enquanto roda:
 *
 *   npm run tiktok:demo
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { loadConfig } from "./config.js";
import { TikTokAuth, TikTokPublisher, type PrivacyLevel } from "./publishers/tiktok/index.js";

/**
 * Modo automático (`npm run tiktok:demo -- --auto`): grava a tela sozinho (screencapture do macOS),
 * abre o navegador no login, recebe a autorização pelo callback.html → localhost:8585, responde
 * tudo com os padrões, publica, abre o perfil e para a gravação. Só o clique em "Autorizar" é humano.
 */
const AUTO = process.argv.includes("--auto");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let recorder: ChildProcess | undefined;
let recordingPath = "";

function startRecording(): void {
  if (process.platform !== "darwin") return;
  mkdirSync(resolve("data", "demo"), { recursive: true });
  recordingPath = resolve("data", "demo", `tiktok-demo-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.mov`);
  // -V: duração máxima em segundos; o processo é encerrado antes com SIGINT, que finaliza o arquivo.
  recorder = spawn("screencapture", ["-V", "600", "-x", recordingPath], { stdio: "ignore" });
  console.log(`🎥 Gravando a tela em ${recordingPath}`);
}

async function stopRecording(): Promise<void> {
  if (!recorder) return;
  recorder.kill("SIGINT");
  await new Promise<void>((done) => {
    recorder?.once("exit", () => done());
    setTimeout(done, 8000);
  });
  console.log(`🎥 Gravação salva: ${recordingPath}`);
}

/** Espera o callback.html do site entregar a URL de retorno em http://localhost:8585/callback. */
function waitCallback(timeoutMs: number): Promise<URL> {
  return new Promise((done, fail) => {
    const server = createServer((req, res) => {
      res.setHeader("access-control-allow-origin", "*");
      res.end("ok");
      const incoming = new URL(req.url ?? "/", "http://localhost:8585");
      if (incoming.pathname === "/callback" && incoming.searchParams.get("code")) {
        server.close();
        done(incoming);
      }
    });
    server.listen(8585);
    setTimeout(() => {
      server.close();
      fail(new Error("Tempo esgotado esperando a autorização no navegador."));
    }, timeoutMs);
  });
}

const PRIVACY_LABEL: Record<string, string> = {
  PUBLIC_TO_EVERYONE: "Público (todos)",
  MUTUAL_FOLLOW_FRIENDS: "Amigos (seguidores mútuos)",
  FOLLOWER_OF_CREATOR: "Seguidores",
  SELF_ONLY: "Somente eu (privado)",
};

const rl = createInterface({ input: stdin, output: stdout });
const ask = async (question: string, fallback: string): Promise<string> => {
  if (AUTO) {
    console.log(`${question} [${fallback}] → ${fallback}`);
    await sleep(1200);
    return fallback;
  }
  const answer = (await rl.question(`${question} [${fallback}] `)).trim();
  return answer === "" ? fallback : answer;
};
const yes = async (question: string, fallback: boolean): Promise<boolean> => {
  const answer = (await ask(`${question} (s/n)`, fallback ? "s" : "n")).toLowerCase();
  return answer.startsWith("s") || answer === "y";
};
const title = (text: string) => console.log(`\n━━━ ${text} ━━━`);

const { env } = loadConfig();
const auth = new TikTokAuth({
  clientKey: env.TIKTOK_CLIENT_KEY,
  clientSecret: env.TIKTOK_CLIENT_SECRET,
  redirectUri: env.TIKTOK_REDIRECT_URI,
  tokensPath: resolve(env.TIKTOK_TOKENS_PATH),
});
const publisher = new TikTokPublisher(auth);

if (AUTO) startRecording();

// 1) Login com TikTok (OAuth com PKCE), só se ainda não houver token salvo. No modo automático o login é sempre refeito (a revisão precisa ver a tela de autorização).
title("1. Entrar com o TikTok");
if (!AUTO && existsSync(resolve(env.TIKTOK_TOKENS_PATH)) && (await yes("Já existe um login salvo. Usar esse login?", true))) {
  console.log("Usando o login salvo.");
} else {
  if (existsSync(resolve(env.TIKTOK_TOKENS_PATH))) unlinkSync(resolve(env.TIKTOK_TOKENS_PATH));
  const { url, codeVerifier, state } = auth.authorizationUrl();
  const pendingPath = resolve(env.TIKTOK_TOKENS_PATH).replace(/\.json$/, "-pending.json");
  writeFileSync(pendingPath, JSON.stringify({ codeVerifier, state, createdAt: new Date().toISOString() }), { mode: 0o600 });
  console.log("\nAbra esta URL no navegador e autorize o app Achadinhos:\n\n" + url + "\n");
  let callback: URL;
  if (AUTO) {
    const waiting = waitCallback(4 * 60_000);
    spawn("open", [url], { stdio: "ignore" });
    console.log("Aguardando você clicar em Autorizar no navegador...");
    callback = await waiting;
  } else {
    callback = new URL(await ask("Cole aqui a URL completa para onde o TikTok redirecionou", ""));
  }
  const code = callback.searchParams.get("code");
  if (!code || callback.searchParams.get("state") !== state) throw new Error("Callback inválido (code ausente ou state diferente).");
  await auth.exchangeCode(code, codeVerifier);
  unlinkSync(pendingPath);
  console.log("Login concluído.");
}

// 2) Dados do criador (obrigatório consultar antes de postar).
title("2. Conta que vai publicar");
const info = await publisher.creatorInfo();
console.log(`Nome: ${info.creator_nickname ?? "?"}  (@${info.creator_username ?? "?"})`);
if (info.creator_avatar_url) console.log(`Avatar: ${info.creator_avatar_url}`);
console.log(`Duração máxima de vídeo: ${info.max_video_post_duration_sec ?? "?"} s`);

// 3) Vídeo e legenda (pré-visualização do que será publicado).
title("3. Conteúdo");
const stock = resolve("data", "drafts", "estoque");
const drafts = existsSync(stock) ? readdirSync(stock).filter((d) => existsSync(resolve(stock, d, "video.mp4"))) : [];
if (drafts.length === 0) throw new Error("Nenhum rascunho com video.mp4 em data/drafts/estoque. Rode `npm run draft` antes.");
drafts.forEach((d, i) => console.log(`  ${i + 1}) ${d}  ${readFileSync(resolve(stock, d, "legenda.txt"), "utf8").split("\n")[0]}`));
const chosen = drafts[Number(await ask("Qual vídeo publicar? (número)", "1")) - 1] ?? drafts[0]!;
const dir = resolve(stock, chosen);
const video = readFileSync(resolve(dir, "video.mp4"));
const defaultCaption = readFileSync(resolve(dir, "legenda.txt"), "utf8").split("\n\nLink")[0]?.trim() ?? "";
console.log(`\nArquivo: ${resolve(dir, "video.mp4")} (${(video.length / 1e6).toFixed(1)} MB)`);
console.log(`Legenda sugerida:\n${defaultCaption}\n`);
const caption = await ask("Legenda a usar (Enter mantém a sugerida)", defaultCaption);

// 4) Privacidade: só as opções que o TikTok devolveu para esta conta.
title("4. Quem pode ver");
info.privacy_level_options.forEach((p, i) => console.log(`  ${i + 1}) ${PRIVACY_LABEL[p] ?? p}`));
const privacy = (info.privacy_level_options[Number(await ask("Escolha a privacidade (número)", "1")) - 1] ?? info.privacy_level_options[0]) as PrivacyLevel;
console.log(`Privacidade: ${PRIVACY_LABEL[privacy] ?? privacy}`);

// 5) Interações (respeitando o que a conta já bloqueia nas configurações do TikTok).
title("5. Interações");
const allowComment = info.comment_disabled ? false : await yes("Permitir comentários?", true);
const allowDuet = info.duet_disabled ? false : await yes("Permitir duetos?", true);
const allowStitch = info.stitch_disabled ? false : await yes("Permitir stitch?", true);
if (info.comment_disabled || info.duet_disabled || info.stitch_disabled) {
  console.log("(algumas interações estão desligadas nas configurações da conta e ficam desligadas aqui)");
}

// 6) Divulgação de conteúdo comercial.
title("6. Conteúdo comercial");
const commercial = await yes("Este vídeo promove uma marca, produto ou serviço?", true);
let brandOrganic = false;
let brandContent = false;
if (commercial) {
  brandOrganic = await yes("  → Sua própria marca (conteúdo orgânico da marca)?", true);
  brandContent = await yes("  → Conteúdo de marca (parceria paga com terceiros)?", false);
  if (brandContent && privacy === "SELF_ONLY") {
    console.log("Conteúdo de marca não pode ser privado. Escolha outra privacidade ou desmarque a parceria.");
    brandContent = false;
  }
  if (brandOrganic || brandContent) {
    console.log(`O vídeo será marcado como: ${[brandOrganic && "Sua marca", brandContent && "Conteúdo de marca"].filter(Boolean).join(" + ")}`);
  }
}

// 7) Consentimento explícito antes de publicar.
title("7. Confirmação");
console.log("Ao publicar, você concorda com a Confirmação de Uso de Música do TikTok" + (brandContent ? " e com a Política de Conteúdo de Marca" : "") + ".");
console.log(`Resumo: @${info.creator_username ?? "?"} · ${PRIVACY_LABEL[privacy] ?? privacy} · comentários ${allowComment ? "on" : "off"} · dueto ${allowDuet ? "on" : "off"} · stitch ${allowStitch ? "on" : "off"}`);
if (!(await yes("Publicar agora no TikTok?", true))) {
  console.log("Cancelado. Nada foi publicado.");
  rl.close();
  process.exit(0);
}

// 8) Publicação direta e acompanhamento do status.
title("8. Publicando");
const publishId = await publisher.publishVideo(video, caption, privacy, {
  disableComment: !allowComment,
  disableDuet: !allowDuet,
  disableStitch: !allowStitch,
  brandOrganic,
  brandContent,
  onStatus: (status) => console.log(`  status: ${status}`),
});
console.log(`\nPublicado. publish_id: ${publishId}`);
console.log("O vídeo pode levar alguns minutos para aparecer no perfil do TikTok.");
if (AUTO && info.creator_username) {
  console.log("Abrindo o perfil para mostrar o vídeo publicado...");
  spawn("open", [`https://www.tiktok.com/@${info.creator_username}`], { stdio: "ignore" });
  await sleep(25_000);
  await stopRecording();
  console.log("\nPronto. Suba o arquivo .mov acima como demo video no portal do TikTok e envie para revisão.");
}
rl.close();
process.exit(0);
