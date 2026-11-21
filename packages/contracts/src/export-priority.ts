import { PRIORITY_LABELS } from "./constants.js";
import type { Priority } from "./schemas.js";

const categoryFields = ["Категория", "category"] as const;
const priorities = [1, 2, 3, 4] as const;
const prioritiesByLabel = new Map<string, Priority>(
  priorities.map((priority) => [PRIORITY_LABELS[priority].toLowerCase(), priority]),
);

function priorityFromLabel(value: unknown): Priority | undefined {
  return typeof value === "string" ? prioritiesByLabel.get(value.trim().toLowerCase()) : undefined;
}

export function readExportPriority(row: Record<string, unknown>): Priority | undefined {
  for (const field of categoryFields) {
    const priority = priorityFromLabel(row[field]);
    if (priority !== undefined) return priority;
  }

  const { priorityId } = row;
  if (priorityId === 1 || priorityId === 2 || priorityId === 3 || priorityId === 4) return priorityId;
  return priorityId == null ? priorityFromLabel(row.priority) : undefined;
}

export function markExportAsCritical(row: Record<string, unknown>): void {
  row.priorityId = 4;
  row.priority = PRIORITY_LABELS[4];
  for (const field of categoryFields) {
    if (priorityFromLabel(row[field]) !== undefined) row[field] = PRIORITY_LABELS[4];
  }
}
