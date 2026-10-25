/**
 * Modo GitHub Actions (uma rodada por execução, sem processo residente):
 *   1. semeia o estado se o banco estiver vazio (data/seed/state.json);
 *   2. coleta, filtra, atualiza o site e manda o relatório;
 *   3. publica no canal em intervalos sorteados durante PUBLISH_WINDOW_MINUTES;
 *   4. poda o histórico e exporta o estado para o seed (commitado pelo workflow).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig } from "./config.js";
import { exportState, importState, openDatabase, prunePriceHistory, closeDatabase, type StateExport } from "./db.js";
import { assertLiveReady, createApp } from "./run.js";

const windowMinutes = Number(process.env.PUBLISH_WINDOW_MINUTES ?? "8");
const seedPath = resolve("data", "seed", "state.json");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const config = loadConfig();
  assertLiveReady(config);

  // Semeia estado (publicados/vistos) quando o banco nasce vazio (cache perdido ou primeira rodada).
  const db = openDatabase(resolve(config.env.DATABASE_PATH));
  const empty = (db.prepare("SELECT COUNT(*) n FROM published").get() as { n: number }).n === 0;
  if (empty && existsSync(seedPath)) {
    importState(db, JSON.parse(readFileSync(seedPath, "utf8")) as StateExport);
    console.log("[ci] estado semeado de data/seed/state.json");
  }
  closeDatabase(db);

  const app = createApp(config);
  const started = Date.now();
  await app.run();

  const deadline = started + windowMinutes * 60_000;
  while (Date.now() < deadline) {
    await app.publishTick();
    await sleep(30_000);
  }

  const db2 = openDatabase(resolve(config.env.DATABASE_PATH));
  const pruned = prunePriceHistory(db2, config.filtros.priceHistoryDays + 1);
  mkdirSync(resolve("data", "seed"), { recursive: true });
  writeFileSync(seedPath, JSON.stringify(exportState(db2)));
  closeDatabase(db2);
  console.log(`[ci] fim: ${pruned} linhas de histórico podadas; seed atualizado.`);
  app.close();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
