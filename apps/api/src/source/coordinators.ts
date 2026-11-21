import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { COORDINATOR_TEAM, CoordinatorListSchema, type Coordinator, type RawIncidentFields } from "@mts/contracts";
import { isMissingFile } from "./file.js";
import { sha256, type NormalizedIncidents } from "./input.js";

function exportedName(raw: RawIncidentFields): string | undefined {
  if (raw.assignedGroupName !== COORDINATOR_TEAM || typeof raw.assignedEmployee !== "string") return undefined;
  return raw.assignedEmployee.trim() || undefined;
}

function exportedCoordinator(name: string): Coordinator {
  return { id: `exported:${sha256(name)}`, name };
}

export function inferCoordinatorDirectory(rows: Iterable<RawIncidentFields>): Coordinator[] {
  const names = new Set<string>();
  for (const row of rows) {
    const name = exportedName(row);
    if (name) names.add(name);
  }
  return [...names].sort().map(exportedCoordinator);
}

export async function readCoordinatorDirectory(dataDir: string): Promise<Coordinator[] | undefined> {
  try {
    const text = await readFile(join(dataDir, "coordinators.json"), "utf8");
    const directory = CoordinatorListSchema.parse(JSON.parse(text.replace(/^\uFEFF/, "")));
    if (new Set(directory.map(({ id }) => id)).size === directory.length
      && new Set(directory.map(({ name }) => name)).size === directory.length) return directory;
  } catch (error) {
    if (isMissingFile(error)) return undefined;
  }
  throw new Error("Не удалось прочитать справочник coordinators.json. Ожидается массив с уникальными id и name.");
}

export function projectCoordinators(
  data: NormalizedIncidents,
  directory: readonly Coordinator[],
  assignments: ReadonlyMap<string, Coordinator>,
): NormalizedIncidents {
  const byName = new Map(directory.map((coordinator) => [coordinator.name, coordinator]));
  const projected = new Map<string, NormalizedIncidents["incidents"][number]>();
  const records = data.records.map((record) => {
    const { incident, raw } = record;
    let coordinator = assignments.get(incident.id);
    if (!coordinator) {
      const name = exportedName(raw);
      if (name) coordinator = byName.get(name) ?? exportedCoordinator(name);
    }
    if (!coordinator) return record;

    const version = sha256(JSON.stringify([incident.version, coordinator.id, coordinator.name]));
    const updated = { ...incident, coordinator, version };
    projected.set(updated.id, updated);
    return { ...record, incident: updated };
  });
  return { ...data, records, incidents: data.incidents.map((incident) => projected.get(incident.id) ?? incident) };
}
