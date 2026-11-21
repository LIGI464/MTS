import { describe, expect, it } from "vitest";
import {
  applyFailure,
  applySuccess,
  createSession,
  editSolution,
  messages,
  prepareSubmit,
  selectIncident,
} from "../model";

const at = "2026-11-21T01:00:00.000Z";
const incidents = [{ id: "INC1", version: "v1" }];

function submit(action: "create-critical" | "escalate" | "resolve" | "deadline", requestId: string, state = createSession()) {
  return prepareSubmit(state, { action, requestId, nowMs: Date.parse(at), at, incidents });
}

describe("prepareSubmit", () => {
  it("не отправляет пустое решение и сохраняет текст", () => {
    const selected = editSolution(selectIncident(createSession(), "INC1"), "   ");
    const prepared = submit("resolve", "uuid-1", selected);
    expect(prepared.intent).toBeNull();
    expect(prepared.state.message).toBe(messages.emptySolution);
    expect(prepared.state.solution).toBe("   ");
    expect(prepared.state.journal[0]).toMatchObject({ id: "INC1", text: messages.emptySolution });
  });

  it("блокирует повторный клик, пока запрос в полёте", () => {
    const selected = selectIncident(createSession(), "INC1");
    const first = submit("escalate", "uuid-1", selected);
    const second = submit("escalate", "uuid-2", first.state);
    expect(second.state).toBe(first.state);
    expect(second.intent).toBeNull();
  });

  it("после обрыва повторяет тот же ключ и то же тело", () => {
    const selected = editSolution(selectIncident(createSession(), "INC1"), "Текст решения");
    const first = submit("resolve", "uuid-1", selected);
    const failed = applyFailure(first.state, "network", at);
    const retry = submit("resolve", "uuid-2", failed);
    expect(retry.intent?.requestId).toBe("uuid-1");
    expect(retry.intent?.solution).toBe("Текст решения");
    expect(retry.intent?.expectedVersion).toBe("v1");
  });

  it("подтверждённое создание выбирает номер сервера", () => {
    const prepared = submit("create-critical", "uuid-1");
    const done = applySuccess(prepared.state, { id: "INC9", version: "v9", revision: 4 }, at);
    expect(done.selectedId).toBe("INC9");
    expect(done.message).toBe("Запись подтверждена. ID INC9.");
    expect(done.versionOverride.INC9).toBe("v9");
    expect(done.journal[0]).toMatchObject({ id: "INC9", text: done.message });
  });

  it("при конфликте сохраняет решение и берёт новую версию", () => {
    const selected = editSolution(selectIncident(createSession(), "INC1"), "Оставить текст");
    const prepared = submit("resolve", "uuid-1", selected);
    const conflict = applyFailure(prepared.state, "conflict", at, "v2");
    expect(conflict.message).toBe(messages.conflict);
    expect(conflict.solution).toBe("Оставить текст");
    expect(conflict.versionOverride.INC1).toBe("v2");
    expect(conflict.retry).toBeNull();
  });
});
