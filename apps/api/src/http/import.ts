import { API_PREFIX, ImportApplyRequestSchema, ImportPreviewRequestSchema, type ApiError } from "@mts/contracts";
import type { FastifyInstance } from "fastify";
import type { RouteContext } from "../runtime-contract.js";
import { requireOperator } from "./operator-token.js";

const importPath = `${API_PREFIX}/incidents/import`;
const previewBodyLimit = 2 * 1024 * 1024;
const invalidRequest = { code: "INVALID_REQUEST", message: "Некорректные параметры импорта." } satisfies ApiError;

export function registerImportRoutes(app: FastifyInstance, { runtime, operatorToken }: RouteContext): void {
  const onRequest = requireOperator(operatorToken);

  app.post(`${importPath}/preview`, { onRequest, bodyLimit: previewBodyLimit }, async (request, reply) => {
    const body = ImportPreviewRequestSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send(invalidRequest);
    return runtime.previewImport(body.data);
  });

  app.post(`${importPath}/apply`, { onRequest }, async (request, reply) => {
    const body = ImportApplyRequestSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send(invalidRequest);
    return runtime.applyImport(body.data);
  });
}
