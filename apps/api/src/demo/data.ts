import { lstat, mkdir, readFile, rename, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { REPO_ROOT } from "../http/config.js";
import { atomicWrite, isMissingFile, stageWrite } from "../source/file.js";
import { BASELINE_FILENAME, LIVE_FILENAME, readIncidentBytes } from "../source/input.js";

const fixtureAnchor = Date.parse("2025-01-01T12:00:00.000Z");

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (isMissingFile(error)) return false;
    throw error;
  }
}

export async function writeDemoFiles(dataDir: string, bytes: Uint8Array): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  const baseline = join(dataDir, BASELINE_FILENAME);
  const live = join(dataDir, LIVE_FILENAME);
  const previousBaseline = await readFile(baseline).catch((error: unknown) => {
    if (isMissingFile(error)) return null;
    throw error;
  });

  const stagedBaseline = await stageWrite(baseline, bytes);
  let stagedLive: string | undefined;
  try {
    stagedLive = await stageWrite(live, bytes);
    await rename(stagedBaseline, baseline);
    try {
      await rename(stagedLive, live);
    } catch (error) {
      if (previousBaseline === null) await rm(baseline);
      else await atomicWrite(baseline, previousBaseline);
      throw error;
    }
  } finally {
    await rm(stagedBaseline, { force: true }).catch(() => {});
    if (stagedLive) await rm(stagedLive, { force: true }).catch(() => {});
  }
}

export async function ensureDemoData(dataDir: string): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  const present = await Promise.all([LIVE_FILENAME, BASELINE_FILENAME, "dashboard.sqlite"].map((name) =>
    exists(join(dataDir, name)),
  ));
  if (present.some(Boolean)) return;

  const template = await readFile(resolve(REPO_ROOT, "data/demo", LIVE_FILENAME));
  const offset = Date.now() - fixtureAnchor;
  const shift = (instant: string) => new Date(Date.parse(instant) + offset).toISOString();
  const records = readIncidentBytes(template).map((raw) => ({
    ...raw,
    submitDate: shift(raw.submitDate),
    deadline: raw.deadline ? shift(raw.deadline) : raw.deadline,
    completionDate: raw.completionDate ? shift(raw.completionDate) : raw.completionDate,
  }));
  await writeDemoFiles(dataDir, Buffer.from(JSON.stringify(records, null, 2) + "\n"));
}
