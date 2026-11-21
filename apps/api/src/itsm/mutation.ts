import { randomUUID } from "node:crypto";
import {
  COORDINATOR_TEAM, PRIORITY_LABELS, STATE_LABELS, isActiveState, markExportAsCritical,
  type AssignCoordinator, type ResolveIncident, type ScenarioCommand,
} from "@mts/contracts";
import { resolvedFields } from "../demo/steps.js";
import type { SourceRecord } from "../source/input.js";

type SourceCommand = ScenarioCommand | (ResolveIncident & { action: "resolve"; id: string });
export type ItsmCommand = SourceCommand | (AssignCoordinator & { action: "set-coordinator"; id: string });
type GetVersion = (id: string) => { version: string; present: boolean } | null;

export class MutationError extends Error {
  constructor(readonly status: 404 | 409, readonly code: string, message: string) {
    super(message);
  }
}

export function requireTicketVersion({ id, expectedVersion }: { id: string; expectedVersion: string }, getVersion: GetVersion): void {
  const current = getVersion(id);
  if (!current) throw new MutationError(404, "NOT_FOUND", "Заявка не найдена.");
  if (!current.present) throw new MutationError(409, "TICKET_ARCHIVED", "Заявка в архиве.");
  if (current.version !== expectedVersion) {
    throw new MutationError(409, "VERSION_CONFLICT", "Заявка изменилась. Перечитайте карточку и повторите действие.");
  }
}

export function planMutation(
  command: SourceCommand,
  records: readonly SourceRecord[],
  getVersion: GetVersion,
  now: string,
): { id: string; rows: Record<string, unknown>[] } {
  const rows = records.map(({ raw }) => raw);
  if (command.action === "create-critical") {
    let sysId = randomUUID();
    while (getVersion(`INC-SYN-${sysId}`)) sysId = randomUUID();
    const id = `INC-SYN-${sysId}`;
    rows.push({
      id, sysId,
      header: "Синтетическая критическая заявка",
      productName: "Демонстрация",
      service: "Тестовые сценарии",
      stateEnum: "Assigned",
      state: STATE_LABELS.Assigned,
      priorityId: 4,
      priority: PRIORITY_LABELS[4],
      assignedGroupName: "Поддержка демонстрации",
      assignedEmployee: null,
      submitDate: now,
      deadline: new Date(Date.parse(now) + 90_000).toISOString(),
      lastAssignmentToTeamDateTime: now,
    });
    return { id, rows };
  }

  requireTicketVersion(command, getVersion);
  const { id } = command;
  const index = records.findIndex(({ incident }) => incident.id === id);
  if (index === -1 || !isActiveState(records[index].incident.state)) {
    throw new MutationError(409, "INVALID_TRANSITION", "Действие доступно для активной заявки.");
  }

  const raw = { ...rows[index] };
  switch (command.action) {
    case "escalate":
      markExportAsCritical(raw);
      break;
    case "assign":
      if (records[index].incident.team !== COORDINATOR_TEAM) {
        raw.assignedGroupName = COORDINATOR_TEAM;
        raw.assignedEmployee = null;
        raw.lastAssignmentToTeamDateTime = now;
      }
      break;
    case "deadline":
      raw.deadline = new Date(command.deadline).toISOString();
      break;
    case "resolve":
      Object.assign(raw, resolvedFields(now), { solution: command.solution.trim() });
      break;
  }
  rows[index] = raw;
  return { id, rows };
}
