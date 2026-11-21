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
  project: CoordinatorProjection,
): NormalizedIncidents {
  const records = data.records.map((record) => {
    const { incident, raw } = record;
    const coordinator = project(raw);
    const version = coordinator ? sha256(JSON.stringify([incident.version, coordinator.id, coordinator.name])) : incident.version;
    return { ...record, incident: { ...incident, coordinator, version } };
  });
  const byId = new Map(records.map(({ incident }) => [incident.id, incident]));
  return { ...data, records, incidents: data.incidents.map((incident) => byId.get(incident.id)!) };
}

export type CoordinatorProjection = (raw: RawIncidentFields | undefined) => Coordinator | null;

export function createCoordinatorProjection(directory: readonly Coordinator[]): CoordinatorProjection {
  const byName = new Map(directory.map((coordinator) => [coordinator.name, coordinator]));
  return (raw) => {
    const name = raw && exportedName(raw);
    return name ? byName.get(name) ?? exportedCoordinator(name) : null;
  };
}
