import type { TicketDetail } from "@mts/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchRegistry, fetchTicket, resolveTicket, ticketPath } from "../api";
import { confirmsResolution, filterTickets } from "../model";

const instant = "2026-11-21T09:30:00.000Z";
const detail: TicketDetail = {
  ticket: {
    id: "SYN-D22/01?",
    version: "v2",
    title: "Проверка доставки",
    product: "Уведомления",
    service: null,
    team: null,
    assignee: null,
    state: "Resolved",
    stateLabel: "Завершен",
    priority: 4,
    createdAt: instant,
    dueAt: null,
    resolvedAt: instant,
    present: true,
    hasSolution: true,
  },
  description: "Полное <b>описание</b>",
  solution: "Очередь восстановлена.",
  history: [{
    version: "v2", at: instant, present: true, stateLabel: "Завершен", team: null, dueAt: null,
    priority: 4, description: "Полное <b>описание</b>", solution: "Очередь восстановлена.",
  }],
};
const receipt = { id: detail.ticket.id, version: "v2", revision: 2 };
const archived = { ...detail.ticket, id: "SYN-D22/02", title: "Смена профиля", product: null, present: false };

afterEach(() => vi.unstubAllGlobals());

describe("ITSM client", () => {
  it("searches by number, title and product without excluding archived or resolved tickets", () => {
    const tickets = [detail.ticket, archived];
    expect(filterTickets(tickets, " ")).toBe(tickets);
    expect(filterTickets(tickets, "d22/02")).toEqual([archived]);
    expect(filterTickets(tickets, "ДОСТАВКИ")).toEqual([detail.ticket]);
    expect(filterTickets(tickets, " уведомления ")).toEqual([detail.ticket]);
    expect(filterTickets(tickets, "не существует")).toEqual([]);
  });

  it("fetches the detail by encoded ID and passes through original text", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json(detail));
    vi.stubGlobal("fetch", fetch);
    const controller = new AbortController();
    expect(ticketPath(detail.ticket.id)).toBe("/itsm/incidents/SYN-D22%2F01%3F");
    await expect(fetchTicket(detail.ticket.id, controller.signal)).resolves.toEqual(detail);
    expect(fetch).toHaveBeenCalledExactlyOnceWith("/api/v1/itsm/incidents/SYN-D22%2F01%3F", {
      cache: "no-store", signal: controller.signal,
    });
  });

  it("distinguishes an empty registry, a missing ticket and malformed data", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ items: [] }))
      .mockResolvedValueOnce(Response.json({ code: "NOT_FOUND", message: "Заявка не найдена." }, { status: 404 }))
      .mockResolvedValueOnce(Response.json({ items: [{}] }));
    vi.stubGlobal("fetch", fetch);
    await expect(fetchRegistry()).resolves.toEqual({ items: [] });
    await expect(fetchTicket(detail.ticket.id)).rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });
    await expect(fetchRegistry()).rejects.toMatchObject({ status: 502 });
  });

  it("sends the exact resolution intent with Bearer and reports version conflicts", async () => {
    const intent = { requestId: "00000000-0000-4000-8000-000000000001", expectedVersion: "v1", solution: "Очередь восстановлена." };
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json(receipt))
      .mockResolvedValueOnce(Response.json({ code: "VERSION_CONFLICT", message: "Заявка изменилась." }, { status: 409 }));
    vi.stubGlobal("fetch", fetch);
    await expect(resolveTicket(detail.ticket.id, "example-token", intent)).resolves.toEqual(receipt);
    await expect(resolveTicket(detail.ticket.id, "example-token", intent)).rejects.toMatchObject({ status: 409, code: "VERSION_CONFLICT" });
    expect(fetch).toHaveBeenNthCalledWith(1, "/api/v1/itsm/incidents/SYN-D22%2F01%3F/resolve", {
      method: "POST", headers: { authorization: "Bearer example-token", "content-type": "application/json" },
      body: JSON.stringify(intent), cache: "no-store",
    });
  });

  it("confirms a resolution only when a fresh resolved card includes the saved version and text", () => {
    expect(confirmsResolution(detail, receipt, detail.solution!)).toBe(true);
    expect(confirmsResolution({ ...detail, history: [] }, receipt, detail.solution!)).toBe(false);
    expect(confirmsResolution({ ...detail, ticket: { ...detail.ticket, state: "Assigned" } }, receipt, detail.solution!)).toBe(false);
    expect(confirmsResolution(detail, receipt, "Другое решение")).toBe(false);
  });
});
