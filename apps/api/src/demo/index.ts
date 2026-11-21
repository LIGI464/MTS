import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { API_PREFIX, type ApiError } from "@mts/contracts";
import type { FastifyInstance } from "fastify";
import { INVALID_OPERATOR_TOKEN, isValidOperatorToken, readBearer } from "../http/operator-token.js";
import type { RouteContext } from "../runtime-contract.js";
import { BASELINE_FILENAME, InvalidIncidentFile } from "../source/input.js";

export { ensureDemoData } from "./data.js";

const RESET_UNAVAILABLE = { code: "RESET_UNAVAILABLE", message: "Сброс демонстрации отключён." } satisfies ApiError;
const BASELINE_UNAVAILABLE = {
  code: "BASELINE_UNAVAILABLE", message: "Исходный набор отсутствует или повреждён.",
} satisfies ApiError;

export function registerDemoRoutes(app: FastifyInstance, context: RouteContext): void {
  app.post(`${API_PREFIX}/demo/reset`, async (request, reply) => {
    const { operatorToken, dataDir, runtime } = context;
    if (!operatorToken) return reply.code(404).send(RESET_UNAVAILABLE);
    if (!isValidOperatorToken(operatorToken, readBearer(request.headers.authorization))) {
      return reply.code(403).send(INVALID_OPERATOR_TOKEN);
    }

    let baseline: Uint8Array;
    try {
      baseline = await readFile(join(dataDir, BASELINE_FILENAME));
    } catch {
      return reply.code(409).send(BASELINE_UNAVAILABLE);
    }
    try {
      return reply.header("Cache-Control", "no-store").send(await runtime.resetTo(baseline));
    } catch (error) {
      if (error instanceof InvalidIncidentFile) return reply.code(409).send(BASELINE_UNAVAILABLE);
      throw error;
    }
  });
}
