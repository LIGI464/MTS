import { COORDINATOR_TEAM } from "@mts/contracts";
import { describe, expect, it } from "vitest";
import { applyDemoStep, DEMO_STEPS, DemoStepError } from "../src/demo/steps.js";
import { InvalidIncidentFile } from "../src/source/input.js";

const now = Date.parse("2032-06-03T12:00:00.000Z");
const submitted = "2032-06-03 11:30:00";
const toBytes = (data: unknown) => Buffer.from(JSON.stringify(data), "utf8");
const fromBytes = (bytes: Uint8Array): unknown => JSON.parse(new TextDecoder().decode(bytes));

describe("demo file steps", () => {
  it("promotes, assigns and resolves the same incident while retaining other export fields", () => {
    const critical = {
      id: "p-01",
      sysId: "00042",
      header: "  Исходный заголовок  ",
      stateEnum: "Assigned",
      state: "Закрыт",
      priorityId: 3,
      submitDate: submitted,
      integration: { flags: [true, "  raw  "] },
    };
    const deadline = { id: "p-02", state: " Выполняется ", priorityId: 1, submitDate: submitted };
    const coordinator = {
      id: "p-00",
      stateEnum: "Assigned",
      priorityId: 3,
      assignedGroupName: COORDINATOR_TEAM,
      submitDate: submitted,
    };
    const rows = [coordinator, critical, deadline];
    const steps = DEMO_STEPS.filter((step) => step !== "deadline");
    const finished = steps.reduce<Uint8Array>(
      (source, step) => applyDemoStep(source, step, now),
      Buffer.from("\uFEFF" + JSON.stringify(rows), "utf8"),
    );
    expect(fromBytes(finished)).toEqual([
      coordinator,
      {
        ...critical,
        priorityId: 4,
        priority: "Наивысший",
        assignedGroupName: COORDINATOR_TEAM,
        stateEnum: "Resolved",
        stateId: 7,
        state: "Завершен",
        completionDate: "2032-06-03T12:00:00.000Z",
      },
      deadline,
    ]);
  });

  it.each([1, 2])("sets the other timer on priority %d when no active priority 3 remains", (priorityId) => {
    const rows = [
      { id: "p-01", stateEnum: "Assigned", priorityId: 4, submitDate: submitted },
      { id: "p-03", stateEnum: "Assigned", priorityId, submitDate: submitted },
      { id: "p-02", stateEnum: "WorkInProgress", priorityId, submitDate: submitted },
      { id: "p-04", stateEnum: "Closed", priorityId: 3, submitDate: submitted },
    ];
    expect(fromBytes(applyDemoStep(toBytes(rows), "deadline", now))).toEqual([
      rows[0],
      rows[1],
      { ...rows[2], deadline: "2032-06-03T12:01:30.000Z" },
      rows[3],
    ]);
  });

  it("fails when no candidate exists or the input is invalid", () => {
    for (const step of DEMO_STEPS) {
      expect(() => applyDemoStep(toBytes([]), step, now)).toThrow(DemoStepError);
    }
    expect(() => applyDemoStep(toBytes({ pseudo: [] }), "critical", now)).toThrow(InvalidIncidentFile);
  });
});
