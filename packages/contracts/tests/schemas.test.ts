import { describe, expect, it } from "vitest";
import { RawIncidentSchema, RawIncidentsSchema } from "@mts/contracts";

const base = {
  id: "INC000000000010",
  submitDate: "2024-05-01 10:11:12",
  priorityId: 3,
};

describe("raw incident schema", () => {
  it("normalizes dictionary dates, keeps extra fields, and treats an empty deadline as null", () => {
    const parsed = RawIncidentSchema.parse({
      ...base,
      deadline: "",
      completionDate: "2024-05-01T13:11:12+03:00",
      assignedEmployee: "  Иванов  ",
      urgencyId: 9,
      impactId: 2,
      sysId: "SYS-10",
      legacyFlag: { ok: true },
    });

    expect(parsed.submitDate).toBe("2024-05-01T10:11:12.000Z");
    expect(parsed.deadline).toBeNull();
    expect(parsed.completionDate).toBe("2024-05-01T10:11:12.000Z");
    expect(parsed.assignedEmployee).toBe("Иванов");
    expect(parsed.urgencyId).toBeNull();
    expect(parsed.impactId).toBe(2);
    expect(parsed.sysId).toBe("SYS-10");
    expect(parsed.legacyFlag).toEqual({ ok: true });
  });

  it("rejects a date without a zone, a numeric sysId, and a duplicate id", () => {
    expect(() => RawIncidentSchema.parse({ ...base, submitDate: "2024-05-01T10:11:12" })).toThrow();
    expect(() => RawIncidentSchema.parse({ ...base, sysId: 1001 })).toThrow();
    expect(() =>
      RawIncidentsSchema.parse([
        base,
        { ...base, submitDate: "2024-05-02 00:00:00" },
      ]),
    ).toThrow(/Повтор id/);
  });

  it.each([
    [{ "Категория": " Наивысший ", priorityId: undefined }, 4],
    [{ category: "НАИВЫСШИЙ", priorityId: 3 }, 4],
    [{ "Категория": "Средний", priorityId: 4 }, 2],
    [{ "Категория": "Связь", priorityId: 4 }, 4],
    [{ priority: "Наивысший", priorityId: undefined }, 4],
  ])("normalizes export priorities from %j to %d", (fields, priorityId) => {
    expect(RawIncidentSchema.parse({ ...base, ...fields }).priorityId).toBe(priorityId);
  });

  it("keeps stateEnum when stateId carries the swapped dictionary value", () => {
    const resolved = RawIncidentSchema.parse({
      ...base,
      stateEnum: "Resolved",
      stateId: 8,
      state: "Закрыт",
    });
    const closed = RawIncidentSchema.parse({
      ...base,
      id: "INC000000000011",
      stateEnum: "Closed",
      stateId: 7,
      state: "Завершен",
    });

    expect(resolved.stateEnum).toBe("Resolved");
    expect(resolved.stateId).toBe(8);
    expect(closed.stateEnum).toBe("Closed");
    expect(closed.stateId).toBe(7);
    expect(resolved.stateEnum).not.toBe(closed.stateEnum);
  });
});
