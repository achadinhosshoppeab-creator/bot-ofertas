import { execFile } from "node:child_process";
import cron from "node-cron";
import { loadConfig } from "./config.js";
import { assertLiveReady, createApp } from "./run.js";

/** Agendador: roda `run` no cron configurado (horário de Brasília) e fica no ar. */
async function main(): Promise<void> {
  const config = loadConfig();
  assertLiveReady(config);
  const app = createApp(config);
  const expression = config.env.SCHEDULE_CRON;

  if (!cron.validate(expression)) {
    throw new Error(`SCHEDULE_CRON inválido: ${expression}`);
  }

  const task = cron.schedule(
    expression,
    async () => {
      await app.run();
    },
    { timezone: "America/Sao_Paulo", noOverlap: true, name: "bot-ofertas" },
  );

  const ticker = cron.schedule("* * * * *", async () => {
    await app.publishTick();
  }, { timezone: "America/Sao_Paulo", noOverlap: true, name: "bot-ofertas-canal" });

  const drafts = config.env.DRAFTS_CRON
    ? cron.schedule(
        config.env.DRAFTS_CRON,
        () => {
          console.log("[drafts] gerando rascunhos do dia…");
          execFile("npx", ["tsx", "src/draft.ts"], { env: { ...process.env, DRAFTS_PER_RUN: String(config.env.DRAFTS_PER_RUN) } }, (error, stdout, stderr) => {
            if (error) {
              void app.alerter.alert(`Rascunhos do dia falharam: ${String(error)}\n${stderr.slice(-500)}`);
              return;
            }
            console.log(stdout.trim());
          });
        },
        { timezone: "America/Sao_Paulo", noOverlap: true, name: "bot-ofertas-drafts" },
      )
    : undefined;

  console.log(
    `[bot-ofertas] coleta "${expression}" (America/Sao_Paulo), canal a cada ${config.filtros.minIntervalMinutesBetweenPosts}–${config.filtros.maxIntervalMinutesBetweenPosts ?? config.filtros.minIntervalMinutesBetweenPosts} min, DRY_RUN=${config.env.DRY_RUN}. Rodando a primeira coleta agora.`,
  );
  await app.run();

  const shutdown = () => {
    console.log("[bot-ofertas] encerrando…");
    void task.stop();
    void ticker.stop();
    void drafts?.stop();
    app.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  process.on("unhandledRejection", (reason) => {
    void app.alerter.alert(`unhandledRejection: ${String(reason)}`);
  });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
