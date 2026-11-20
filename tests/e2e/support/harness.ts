import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
export const OPERATOR_TOKEN = "e2e-operator-token";
const LIVE_FILENAME = "character_problems.json";
const START_JS = join(REPO_ROOT, "apps/api/dist/start.js");
const STEP_JS = join(REPO_ROOT, "apps/api/dist/demo/cli/step.js");

const tracked = new Set<ChildProcess>();
process.on("exit", () => {
  for (const child of tracked) {
    try {
      child.kill("SIGKILL");
    } catch {
      // The child has already exited.
    }
  }
});

export type AnalysisMode = "rules" | "live-ok" | "live-fail";

export type RunningApp = {
  url: string;
  dataDir: string;
  port: number;
  halt: () => Promise<void>;
  resume: () => Promise<void>;
  restart: () => Promise<void>;
  stop: () => Promise<void>;
};

type LogBuffer = { text: string };

export async function startDashboard(mode: AnalysisMode = "rules", itsmTemplate = ""): Promise<RunningApp> {
  await access(START_JS);
  const dataDir = await mkdtemp(join(tmpdir(), "mts-e2e-"));
  const port = await freePort();
  const mock = mode === "rules" ? undefined : await startResponsesMock(mode === "live-ok");
  const log: LogBuffer = { text: "" };
  let child = spawnApi(port, dataDir, mode, itsmTemplate, mock?.baseUrl, log);
  let stopped = false;

  async function ready(): Promise<void> {
    await waitUntilReady(`http://127.0.0.1:${port}`, child, log);
  }

  await ready();

  return {
    url: `http://127.0.0.1:${port}`,
    dataDir,
    port,
    async halt() {
      if (stopped) throw new Error("Сервер уже остановлен.");
      await stopChild(child);
    },
    async resume() {
      if (stopped) throw new Error("Сервер уже остановлен.");
      if (!hasExited(child)) throw new Error("Сервер ещё работает.");
      log.text = "";
      child = spawnApi(port, dataDir, mode, itsmTemplate, mock?.baseUrl, log);
      await ready();
    },
    async restart() {
      if (stopped) throw new Error("Сервер уже остановлен.");
      await stopChild(child);
      await delay(300);
      log.text = "";
      child = spawnApi(port, dataDir, mode, itsmTemplate, mock?.baseUrl, log);
      await ready();
    },
    async stop() {
      if (stopped) return;
      stopped = true;
      await stopChild(child);
      await mock?.close();
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}

export function applyDemoStep(dataDir: string, step: "critical" | "assign" | "deadline" | "resolve"): void {
  const result = spawnSync(process.execPath, [STEP_JS, step], {
    cwd: REPO_ROOT,
    env: { ...process.env, MTS_DATA_DIR: dataDir },
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `Шаг ${step} не применился.`);
  }
}

export async function readLive(dataDir: string): Promise<string> {
  return readFile(join(dataDir, LIVE_FILENAME), "utf8");
}

export async function writeLive(dataDir: string, contents: string | Uint8Array): Promise<void> {
  const path = join(dataDir, LIVE_FILENAME);
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, contents);
  try {
    for (let attempt = 0; ; attempt += 1) {
      try {
        await rename(temp, path);
        return;
      } catch (error) {
        const code = error instanceof Error && "code" in error ? String(error.code) : "";
        if (attempt >= 30 || !["EPERM", "EBUSY", "EACCES"].includes(code)) throw error;
        await delay(20);
      }
    }
  } catch (error) {
    await rm(temp, { force: true }).catch(() => {});
    throw error;
  }
}

export async function removeLive(dataDir: string): Promise<void> {
  await rm(join(dataDir, LIVE_FILENAME), { force: true });
}

function spawnApi(
  port: number,
  dataDir: string,
  mode: AnalysisMode,
  itsmTemplate: string,
  baseUrl: string | undefined,
  log: LogBuffer,
): ChildProcess {
  const live = mode !== "rules";
  const child = spawn(process.execPath, [START_JS], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      MTS_DATA_DIR: dataDir,
      MTS_DATA_POLL_MS: "200",
      MTS_OPERATOR_TOKEN: OPERATOR_TOKEN,
      MTS_ITSM_URL_TEMPLATE: itsmTemplate,
      MTS_AI_MODE: live ? "live" : "rules",
      CODEX_SALE_API_KEY: live ? "e2e-provider-key" : "",
      CODEX_SALE_MODEL: live ? "e2e-model" : "",
      CODEX_SALE_BASE_URL: baseUrl ?? "https://codex.sale/v1",
      MTS_AI_TIMEOUT_MS: "4000",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  tracked.add(child);
  const append = (chunk: Buffer) => {
    log.text = `${log.text}${chunk.toString("utf8")}`.slice(-8000);
  };
  child.stdout?.on("data", append);
  child.stderr?.on("data", append);
  child.once("exit", () => tracked.delete(child));
  return child;
}

async function startResponsesMock(ok: boolean): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = createHttpServer((request: IncomingMessage, response: ServerResponse) => {
    request.resume();
    request.on("end", () => {
      if (!ok) {
        response.writeHead(500, { "content-type": "text/plain" });
        response.end("mock provider down");
        return;
      }
      const text = JSON.stringify({
        summary: "Выжимка мок-провайдера для координатора.",
        team: null,
        reason: "Мок подтвердил факты инцидента.",
      });
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        status: "completed",
        output: [{ type: "message", status: "completed", content: [{ type: "output_text", text }] }],
      }));
    });
  });
  const port = await new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address === "object") resolve(address.port);
      else reject(new Error("Мок-сервер не получил порт."));
    });
  });
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

async function waitUntilReady(baseUrl: string, child: ChildProcess, log: LogBuffer): Promise<void> {
  const deadline = Date.now() + 20_000;
  let last = "нет ответа";
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`API завершился с кодом ${child.exitCode}\n${log.text}`);
    }
    try {
      const response = await fetch(`${baseUrl}/healthz`, { signal: AbortSignal.timeout(1000) });
      const body = await response.json() as { status?: string; source?: string };
      if (response.ok && body.status === "ok" && body.source === "ok") return;
      last = JSON.stringify(body);
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await delay(150);
  }
  throw new Error(`API не готов: ${last}\n${log.text}`);
}

function hasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (hasExited(child)) return;
  child.kill("SIGINT");
  const graceful = await waitExit(child, 5_000);
  if (!graceful) {
    child.kill("SIGKILL");
    await waitExit(child, 5_000);
  }
}

function waitExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (hasExited(child)) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = address && typeof address === "object" ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
