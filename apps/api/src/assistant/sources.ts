import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Snapshot } from "@mts/contracts";
import { BASELINE_FILENAME, LIVE_FILENAME } from "../source/input.js";

export type DataSourceStatus = { name: string; ok: boolean };

export function listDataSources(dataDir: string, snapshot: Snapshot): readonly DataSourceStatus[] {
  const liveOk = snapshot.source.status === "ok" || snapshot.source.status === "stale";
  const archiveOk = snapshot.revision > 0 || snapshot.incidents.length > 0;
  return Object.freeze([
    { name: LIVE_FILENAME, ok: liveOk },
    { name: "dashboard.sqlite", ok: archiveOk || existsSync(join(dataDir, "dashboard.sqlite")) },
    { name: BASELINE_FILENAME, ok: existsSync(join(dataDir, BASELINE_FILENAME)) },
    { name: "coordinators.json", ok: existsSync(join(dataDir, "coordinators.json")) },
  ]);
}