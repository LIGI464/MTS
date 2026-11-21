import { maxHeaderSize } from "node:http";
import { basename, extname } from "node:path";
import fastifyStatic from "@fastify/static";
import { API_PREFIX, type ApiError } from "@mts/contracts";
import Fastify, { LogController, type FastifyInstance } from "fastify";
import { registerAnalysisRoutes } from "../analysis/index.js";
import { registerPriorityFeed } from "../analysis/priorities.js";
import { registerDemoRoutes } from "../demo/index.js";
import { registerItsmRoutes } from "../itsm/index.js";
import { MutationError } from "../itsm/mutation.js";
import type { RouteContext } from "../runtime-contract.js";
import { registerEvents } from "./events.js";
import { registerImportRoutes } from "./import.js";

const NOT_FOUND = { code: "NOT_FOUND", message: "Маршрут не найден." } satisfies ApiError;

export function buildApp(context: RouteContext, webRoot?: string): FastifyInstance {
  const { runtime } = context;
  const app = Fastify({
    logger: { level: "warn" },
    logController: new LogController({ disableRequestLogging: true }),
    bodyLimit: 8 * 1024,
    routerOptions: { maxParamLength: maxHeaderSize },
  });
  app.addHook("onClose", async () => runtime.close());

  app.get("/healthz", async () => ({ status: "ok", source: runtime.getSnapshot().source.status }));
  app.get(`${API_PREFIX}/dashboard`, async (_request, reply) => {
    return reply.header("Cache-Control", "no-store").send(runtime.getSnapshot());
  });
  registerEvents(app, runtime);
  registerDemoRoutes(app, context);
  registerAnalysisRoutes(app, context);
  registerPriorityFeed(app, context);
  registerItsmRoutes(app, context);
  registerImportRoutes(app, context);

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof MutationError) {
      return reply.code(error.status).send({ code: error.code, message: error.message } satisfies ApiError);
    }
    const status = error instanceof Error && "statusCode" in error && typeof error.statusCode === "number"
      ? error.statusCode : 500;
    if (status === 413) {
      const response: ApiError = {
        code: "BODY_TOO_LARGE",
        message: `Размер запроса превышает ${request.routeOptions.bodyLimit / 1024} КиБ.`,
      };
      return reply.code(413).send(response);
    }
    if (status >= 400 && status < 500) {
      const response: ApiError = { code: "INVALID_REQUEST", message: "Некорректный запрос." };
      return reply.code(status).send(response);
    }
    const response: ApiError = { code: "INTERNAL_ERROR", message: "Внутренняя ошибка сервера." };
    return reply.code(500).send(response);
  });

  if (webRoot) {
    void app.register(fastifyStatic, {
      root: webRoot,
      index: false,
      allowedPath: (_path, _root, request) => !/^\/api(?:\/|\?|$)/.test(request.url),
      cacheControl: false,
      setHeaders(reply, path) {
        const immutable = /[/\\]assets[/\\]/.test(path) && /-[\w-]{8,}\.[a-z0-9]+$/i.test(basename(path));
        reply.header("Cache-Control", immutable ? "public, max-age=31536000, immutable" : "no-store");
      },
    });
    for (const route of ["/", "/admin/incidents", "/admin/developers", "/itsm/incidents", "/itsm/incidents/:id"]) {
      app.get(route, async (_request, reply) => reply.header("Cache-Control", "no-store").sendFile("index.html"));
    }
  }

  app.setNotFoundHandler((request, reply) => {
    const path = request.url.split("?", 1)[0] ?? "";
    const isWeb = !/^\/(?:api|assets)(?:\/|$)/.test(path) && !extname(path);
    if (webRoot && isWeb && (request.method === "GET" || request.method === "HEAD")) {
      return reply.header("Cache-Control", "no-store").sendFile("index.html");
    }
    return reply.code(404).send(NOT_FOUND);
  });
  return app;
}
