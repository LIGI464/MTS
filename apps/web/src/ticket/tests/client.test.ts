import { describe, expect, it } from "vitest";
import { assignCoordinator, fetchCoordinators, fetchTicketDetail, TicketRequestError } from "../client";

const ticketId = "INC/1";
const detail = {
  ticket: {
    id: ticketId,
    version: "v1",
    title: "Сбой авторизации",
    product: "МТС",
    service: null,
    team: "КЦ ИТ Координаторы Массовых Инцидентов",
    assignee: "Иванова",
    coordinator: { id: "c-1", name: "Иванова" },
    state: "Assigned",
    stateLabel: "Назначен",
    priority: 3,
    createdAt: "2024-05-01T10:11:12.000Z",
    dueAt: null,
    resolvedAt: null,
    present: true,
    hasSolution: false,
  },
  description: "Полное описание",
  solution: null,
  history: [],
  rawFields: {
    id: ticketId,
    deadline: "",
    waitingExitDate: null,
    flag: false,
    count: 0,
    stateId: 7,
    unknown: { keep: true },
  },
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("клиент D23", () => {
  it("читает все исходные поля и не подменяет их типы", async () => {
    const fetchImpl: typeof fetch = async (url) => {
      expect(String(url)).toBe("/api/v1/itsm/incidents/INC%2F1");
      return jsonResponse(200, detail);
    };

    const loaded = await fetchTicketDetail(fetchImpl, ticketId);
    expect(loaded.rawFields).toEqual(detail.rawFields);
    expect(loaded.ticket.coordinator).toEqual({ id: "c-1", name: "Иванова" });
  });

  it("отклоняет карточку без исходных полей", async () => {
    const { rawFields, ...legacy } = detail;
    void rawFields;
    const fetchImpl: typeof fetch = async () => jsonResponse(200, legacy);
    await expect(fetchTicketDetail(fetchImpl, ticketId)).rejects.toMatchObject({
      status: 502,
      code: "INVALID_TICKET",
    });
  });

  it("читает справочник и назначает выбранного координатора с версией заявки", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith("/coordinators")) {
        return jsonResponse(200, [{ id: "c-2", name: "Петров" }]);
      }
      return jsonResponse(200, { id: ticketId, version: "v2", revision: 4 });
    };

    await expect(fetchCoordinators(fetchImpl)).resolves.toEqual([{ id: "c-2", name: "Петров" }]);
    const requestId = "8d8a1b2e-3c4f-4a5b-9c6d-7e8f90123456";
    const result = await assignCoordinator(fetchImpl, ticketId, "operator-token", {
      coordinatorId: "c-2",
      expectedVersion: "v1",
      requestId,
    });

    expect(result).toEqual({ id: ticketId, version: "v2", revision: 4 });
    const post = calls[1];
    expect(post?.url).toBe("/api/v1/itsm/incidents/INC%2F1/coordinator");
    expect(post?.init?.method).toBe("POST");
    expect(new Headers(post?.init?.headers).get("authorization")).toBe("Bearer operator-token");
    expect(JSON.parse(String(post?.init?.body))).toEqual({
      coordinatorId: "c-2",
      expectedVersion: "v1",
      requestId,
    });
  });

  it("сохраняет код конфликта версии и неизвестного координатора", async () => {
    const conflict: typeof fetch = async () => jsonResponse(409, {
      code: "VERSION_CONFLICT",
      message: "Заявка изменилась.",
    });
    await expect(assignCoordinator(conflict, ticketId, "operator-token", {
      coordinatorId: "c-2",
      expectedVersion: "v1",
      requestId: "8d8a1b2e-3c4f-4a5b-9c6d-7e8f90123456",
    })).rejects.toBeInstanceOf(TicketRequestError);
    await expect(assignCoordinator(conflict, ticketId, "operator-token", {
      coordinatorId: "c-2",
      expectedVersion: "v1",
      requestId: "8d8a1b2e-3c4f-4a5b-9c6d-7e8f90123456",
    })).rejects.toMatchObject({ status: 409, code: "VERSION_CONFLICT" });

    const missing: typeof fetch = async () => jsonResponse(404, {
      code: "COORDINATOR_NOT_FOUND",
      message: "Координатор недоступен в справочнике.",
    });
    await expect(assignCoordinator(missing, ticketId, "operator-token", {
      coordinatorId: "c-9",
      expectedVersion: "v1",
      requestId: "8d8a1b2e-3c4f-4a5b-9c6d-7e8f90123456",
    })).rejects.toMatchObject({ status: 404, code: "COORDINATOR_NOT_FOUND" });
  });
});
