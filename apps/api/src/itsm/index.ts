import { API_PREFIX, ResolveIncidentSchema, ScenarioCommandSchema, type ApiError } from "@mts/contracts";
import type { FastifyInstance, onRequestHookHandler } from "fastify";
import { INVALID_OPERATOR_TOKEN, isValidOperatorToken, readBearer } from "../http/operator-token.js";
import type { RouteContext } from "../runtime-contract.js";

const incidentsPath = `${API_PREFIX}/itsm/incidents`;
const TICKET_NOT_FOUND = { code: "NOT_FOUND", message: "Заявка не найдена." } satisfies ApiError;
const OPERATOR_DISABLED = { code: "OPERATOR_DISABLED", message: "Операторские действия отключены." } satisfies ApiError;
const INVALID_REQUEST = { code: "INVALID_REQUEST", message: "Некорректные параметры действия." } satisfies ApiError;

export function registerItsmRoutes(app: FastifyInstance, { runtime, operatorToken }: RouteContext): void {
  app.get(incidentsPath, async (_request, reply) => {
    return reply.header("Cache-Control", "no-store").send(runtime.listTickets());
  });

  app.get<{ Params: { id: string } }>(`${incidentsPath}/:id`, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const detail = runtime.getTicket(request.params.id);
    if (!detail) return reply.code(404).send(TICKET_NOT_FOUND);
    return reply.send(detail);
  });

  const requireOperator: onRequestHookHandler = async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    if (!operatorToken) return reply.code(404).send(OPERATOR_DISABLED);
    if (!isValidOperatorToken(operatorToken, readBearer(request.headers.authorization))) {
      return reply.code(403).send(INVALID_OPERATOR_TOKEN);
    }
  };

  app.post(`${API_PREFIX}/dev/scenarios`, { onRequest: requireOperator }, async (request, reply) => {
    const command = ScenarioCommandSchema.safeParse(request.body);
    if (!command.success) return reply.code(400).send(INVALID_REQUEST);
    return runtime.mutate(command.data);
  });

  app.post<{ Params: { id: string } }>(`${incidentsPath}/:id/resolve`, { onRequest: requireOperator }, async (request, reply) => {
    const command = ResolveIncidentSchema.safeParse(request.body);
    if (!command.success) return reply.code(400).send(INVALID_REQUEST);
    return runtime.mutate({ ...command.data, action: "resolve", id: request.params.id });
  });
}
