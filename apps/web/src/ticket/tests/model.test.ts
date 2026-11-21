import { describe, expect, it } from "vitest";
import {
  assignmentFailure,
  assignmentHint,
  canAssign,
  coordinatorOutsideDirectory,
  describeRawValue,
  formatRawFields,
  personalCoordinatorLine,
} from "../model";

const gate = {
  present: true,
  directoryEmpty: false,
  token: "operator",
  coordinatorId: "c-2",
  currentId: "c-1",
  pending: false,
};

describe("поля заявки", () => {
  it("сохраняет ключи и отличает пустую строку, ноль, false и null", () => {
    const fields = formatRawFields({
      deadline: "",
      waitingExitDate: null,
      flag: false,
      count: 0,
      stateId: "7",
      extra: { nested: true },
      tags: ["a"],
    });

    expect(fields.map((field) => field.key)).toEqual([
      "deadline",
      "waitingExitDate",
      "flag",
      "count",
      "stateId",
      "extra",
      "tags",
    ]);
    expect(describeRawValue("")).toEqual({ type: "string", text: "\"\"" });
    expect(fields.find((field) => field.key === "waitingExitDate")).toEqual({
      key: "waitingExitDate",
      type: "null",
      text: "null",
    });
    expect(fields.find((field) => field.key === "flag")?.text).toBe("false");
    expect(fields.find((field) => field.key === "count")).toMatchObject({ type: "number", text: "0" });
    expect(fields.find((field) => field.key === "stateId")).toMatchObject({ type: "string", text: "7" });
    expect(fields.find((field) => field.key === "extra")?.text).toBe("{\"nested\":true}");
  });
});

describe("персональный координатор", () => {
  it("показывает назначенного человека и молчит, если назначения нет", () => {
    expect(personalCoordinatorLine({ id: "c-1", name: "Иванова" })).toBe("Персональный координатор: Иванова");
    expect(personalCoordinatorLine(null)).toBeNull();
    expect(personalCoordinatorLine(undefined)).toBeNull();
  });

  it("не даёт назначить архив, пустой справочник, себя и запрос без токена", () => {
    expect(canAssign(gate)).toBe(true);
    expect(assignmentHint({ ...gate, present: false })).toMatch(/архиве/);
    expect(assignmentHint({ ...gate, directoryEmpty: true })).toMatch(/пуст/);
    expect(assignmentHint({ ...gate, token: "  " })).toMatch(/токен/i);
    expect(assignmentHint({ ...gate, coordinatorId: "" })).toMatch(/Выберите/);
    expect(assignmentHint({ ...gate, currentId: "c-2" })).toMatch(/уже назначен/);
    expect(canAssign({ ...gate, pending: true })).toBe(false);
  });

  it("отличает человека из карточки, которого нет в справочнике", () => {
    const directory = [{ id: "c-1", name: "Иванова" }];
    expect(coordinatorOutsideDirectory(directory, { id: "exported:1", name: "Петров" })).toBe(true);
    expect(coordinatorOutsideDirectory(directory, directory[0])).toBe(false);
    expect(coordinatorOutsideDirectory(directory, null)).toBe(false);
  });

  it("переводит ответы контракта в текст для формы", () => {
    expect(assignmentFailure(409, "VERSION_CONFLICT")).toMatch(/Перечитайте/);
    expect(assignmentFailure(409, "TICKET_ARCHIVED")).toMatch(/архиве/);
    expect(assignmentFailure(404, "COORDINATOR_NOT_FOUND")).toMatch(/справочнике/);
    expect(assignmentFailure(404, "NOT_FOUND")).toMatch(/не найдена/);
    expect(assignmentFailure(403)).toMatch(/Токен/);
    expect(assignmentFailure(0, "NETWORK")).toMatch(/Не удалось сохранить/);
  });
});
