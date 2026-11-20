import { API_PREFIX, type ApiError } from "@mts/contracts";
import type { FastifyInstance } from "fastify";
import type { DashboardRuntime } from "../runtime-contract.js";

const incidentsPath = `${API_PREFIX}/itsm/incidents`;
const TICKET_NOT_FOUND = { code: "NOT_FOUND", message: "Заявка не найдена." } satisfies ApiError;

export function registerItsmRoutes(app: FastifyInstance, runtime: DashboardRuntime): void {
  app.get(incidentsPath, async (_request, reply) => {
    return reply.header("Cache-Control", "no-store").send(runtime.listTickets());
  });

  app.get<{ Params: { id: string } }>(`${incidentsPath}/:id`, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const detail = runtime.getTicket(request.params.id);
    if (!detail) return reply.code(404).send(TICKET_NOT_FOUND);
    return reply.send(detail);
  });
}
