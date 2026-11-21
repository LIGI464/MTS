import { describe, expect, it } from "vitest";
import { DeveloperRequestError, commandBody, sendCommand } from "../client";
import { messages, type Intent } from "../model";

const intent: Intent = {
  requestId: "uuid-1",
  action: "escalate",
  id: "INC 1",
  expectedVersion: "v1",
  solution: null,
  deadline: null,
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("sendCommand", () => {
  it("отправляет один сценарий с токеном и показывает подтверждение", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return jsonResponse(200, { id: "INC9", version: "v9", revision: 2 });
    };
    const receipt = await sendCommand(fetchImpl, intent, "operator-token");
    expect(receipt).toEqual({ id: "INC9", version: "v9", revision: 2 });
    expect(calls[0]?.url).toBe("/api/v1/dev/scenarios");
    expect(calls[0]?.init.method).toBe("POST");
    const headers = new Headers(calls[0]?.init.headers);
    expect(headers.get("authorization")).toBe("Bearer operator-token");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual(commandBody(intent));
    expect(messages.confirmed(receipt.id)).toBe("Запись подтверждена. ID INC9.");
  });

  it("отличает отказ токена от обрыва соединения", async () => {
    const denied: typeof fetch = async () => jsonResponse(403, { code: "OPERATOR_TOKEN_INVALID", message: "нет" });
    await expect(sendCommand(denied, intent, "bad")).rejects.toMatchObject({
      kind: "token",
      message: messages.token,
    });

    const dropped: typeof fetch = async () => {
      throw new TypeError("network down");
    };
    await expect(sendCommand(dropped, intent, "operator-token")).rejects.toBeInstanceOf(DeveloperRequestError);
    await expect(sendCommand(dropped, intent, "operator-token")).rejects.toMatchObject({
      kind: "network",
      message: messages.network,
    });
  });
});
