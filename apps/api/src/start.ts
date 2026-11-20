import { LOCAL_API_PORT } from "@mts/contracts";
import Fastify, { type FastifyInstance } from "fastify";

export function createApp(): FastifyInstance {
  const app = Fastify({ logger: false });
  app.get("/healthz", async () => ({ status: "ok" as const, source: "unavailable" as const }));
  return app;
}

async function main(): Promise<void> {
  const host = process.env.HOST ?? "127.0.0.1";
  const port = Number(process.env.PORT ?? LOCAL_API_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error(`Некорректный PORT: ${process.env.PORT ?? ""}`);
    process.exit(1);
  }

  const app = createApp();
  try {
    await app.listen({ host, port });
  } catch (error) {
    const code = error instanceof Error && "code" in error ? String(error.code) : "";
    if (code === "EADDRINUSE") {
      console.error(`Порт ${host}:${port} уже занят.`);
      process.exit(1);
    }
    console.error(error);
    process.exit(1);
  }
  console.log(`API слушает http://${host}:${port}`);
}

const entry = process.argv[1]?.replaceAll("\\", "/");
if (entry?.endsWith("/start.ts") || entry?.endsWith("/start.js")) {
  await main();
}
