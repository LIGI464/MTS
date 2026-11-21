import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { LOCAL_API_PORT } from "@mts/contracts";
import type { FastifyInstance } from "fastify";
import { ensureDemoData } from "./demo/index.js";
import { REPO_ROOT, dataDirectory, liveAnalysisEnabled, operatorToken, positiveInteger } from "./http/config.js";
import { buildApp } from "./http/index.js";
import { createDashboardRuntime } from "./source/index.js";

export async function createApp(env = process.env, serveWeb = false): Promise<FastifyInstance> {
  const dataDir = dataDirectory(env);
  const token = operatorToken(env);
  await ensureDemoData(dataDir);
  const runtime = await createDashboardRuntime({
    dataDir,
    pollMs: positiveInteger(env.MTS_DATA_POLL_MS, 500),
    itsmTemplate: env.MTS_ITSM_URL_TEMPLATE?.trim(),
    capabilities: { demoReset: Boolean(token), liveAnalysis: liveAnalysisEnabled(env, token) },
  });
  try {
    const webRoot = serveWeb ? resolve(REPO_ROOT, "apps/web/dist") : undefined;
    return buildApp({ runtime, dataDir, operatorToken: token, env }, webRoot);
  } catch (error) {
    await runtime.close();
    throw error;
  }
}

async function main(): Promise<void> {
  const host = process.env.HOST || "127.0.0.1";
  const port = Number(process.env.PORT ?? LOCAL_API_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error("PORT должен быть целым числом от 1 до 65535.");
    process.exitCode = 1;
    return;
  }

  let app: FastifyInstance | undefined;
  try {
    app = await createApp(process.env, import.meta.url.endsWith(".js"));
    await app.listen({ host, port });
    console.log(`API слушает http://${host}:${port}`);
    const running = app;
    const stop = () => {
      void running.close().catch(() => {
        console.error("Ошибка при остановке API.");
        process.exitCode = 1;
      });
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  } catch (error) {
    await app?.close().catch(() => {});
    const code = error instanceof Error && "code" in error ? error.code : undefined;
    console.error(code === "EADDRINUSE" ? `Порт ${host}:${port} уже занят.` : "Не удалось запустить API.");
    process.exitCode = 1;
  }
}

const entry = process.argv[1];
if (entry && pathToFileURL(resolve(entry)).href === import.meta.url) await main();
