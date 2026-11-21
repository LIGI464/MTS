import type { ServerResponse } from "node:http";
import { API_PREFIX, type Snapshot } from "@mts/contracts";
import type { FastifyInstance } from "fastify";
import type { DashboardRuntime } from "../runtime-contract.js";

function dashboardFrame(snapshot: Snapshot): string {
  return `event: dashboard\ndata: ${JSON.stringify(snapshot)}\n\n`;
}

export function registerEvents(app: FastifyInstance, runtime: DashboardRuntime): void {
  const streams = new Set<ServerResponse>();
  app.addHook("preClose", async () => {
    for (const stream of streams) stream.end();
  });

  app.get(`${API_PREFIX}/events`, async (_request, reply) => {
    reply.hijack();
    const response = reply.raw;
    streams.add(response);
    response.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    });

    function write(frame: string): void {
      if (response.destroyed || response.writableEnded) return;
      if (response.writableNeedDrain) {
        // Bound the queued data for slow clients. Reconnection sends a fresh full snapshot.
        response.destroy();
        return;
      }
      response.write(frame);
    }

    const heartbeat = setInterval(() => write(": ping\n\n"), 15_000);
    const unsubscribe = runtime.subscribe((snapshot) => write(dashboardFrame(snapshot)));
    response.once("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
      streams.delete(response);
    });
    // Registration and the first write are synchronous, with no poll between them.
    write(dashboardFrame(runtime.getSnapshot()));
  });
}
