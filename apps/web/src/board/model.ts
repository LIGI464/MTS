import type { GroupKey, Incident, Snapshot } from "@mts/contracts";

export const GROUP_ORDER = [
  ["critical", "Критические"],
  ["coordinator", "У координаторов"],
  ["high", "Высокий приоритет"],
  ["research", "Исследование"],
] as const satisfies ReadonlyArray<readonly [GroupKey, string]>;

export type BoardCard = {
  id: string;
  incident: Incident | null;
};

export function cardsForGroup(snapshot: Snapshot, key: GroupKey): BoardCard[] {
  const incidents = new Map(snapshot.incidents.map((incident) => [incident.id, incident]));
  return snapshot.groups[key].map((id) => ({
    id,
    incident: incidents.get(id) ?? null,
  }));
}

export function displayText(value: string | null, empty: string): string {
  if (value === null || value.trim().length === 0) return empty;
  return value;
}
