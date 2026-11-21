import {
  COORDINATOR_TEAM,
  PRIORITY_LABELS,
  STATE_LABELS,
  isActiveState,
} from "@mts/contracts";
import { incidentState, readIncidentBytes } from "../source/input.js";

export const DEMO_STEPS = ["critical", "assign", "deadline", "resolve"] as const;
export type DemoStep = (typeof DEMO_STEPS)[number];

const NO_TARGET: Record<DemoStep, string> = {
  critical: "Нет активного инцидента высокого приоритета вне группы координаторов.",
  assign: "Нет активного критического инцидента для назначения.",
  deadline: "Нет другого активного инцидента с приоритетом от 1 до 3.",
  resolve: "Нет активного критического инцидента для завершения.",
};

export class DemoStepError extends Error {
  constructor(step: DemoStep) {
    super(NO_TARGET[step]);
  }
}

export function applyDemoStep(bytes: Uint8Array, step: DemoStep, nowMs = Date.now()): Uint8Array {
  const records = readIncidentBytes(bytes);
  // Use validated records to select a row, then edit the original export values.
  const original = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>[];
  const active = records
    .map((record, index) => ({ record, index }))
    .filter(({ record }) => isActiveState(incidentState(record)));

  let target;
  switch (step) {
    case "critical":
      target = active.find(({ record }) => record.priorityId === 3 && record.assignedGroupName !== COORDINATOR_TEAM);
      break;
    case "assign":
    case "resolve":
      target = active.find(({ record }) => record.priorityId === 4);
      break;
    case "deadline":
      target = active.filter(({ record }) => record.priorityId < 4).sort(({ record: left }, { record: right }) => {
        return right.priorityId - left.priorityId || (left.id < right.id ? -1 : 1);
      })[0];
      break;
  }
  if (!target) throw new DemoStepError(step);

  const raw = original[target.index];
  switch (step) {
    case "critical":
      raw.priorityId = 4;
      raw.priority = PRIORITY_LABELS[4];
      break;
    case "assign":
      raw.assignedGroupName = COORDINATOR_TEAM;
      break;
    case "deadline":
      raw.deadline = new Date(nowMs + 90_000).toISOString();
      break;
    case "resolve":
      raw.stateEnum = "Resolved";
      raw.stateId = 7;
      raw.state = STATE_LABELS.Resolved;
      raw.completionDate = new Date(nowMs).toISOString();
      break;
  }
  const updated = Buffer.from(`${JSON.stringify(original, null, 2)}\n`, "utf8");
  readIncidentBytes(updated);
  return updated;
}
