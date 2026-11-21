import { randomUUID } from "node:crypto";
import { rename, rm, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

const REPLACE_RETRY = new Set(["EPERM", "EBUSY", "EACCES"]);

export function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

export async function stageWrite(path: string, bytes: Uint8Array): Promise<string> {
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, bytes, { flag: "wx", mode: 0o600, flush: true });
    return temp;
  } catch (error) {
    await rm(temp, { force: true }).catch(() => {});
    throw error;
  }
}

export async function atomicWrite(path: string, bytes: Uint8Array): Promise<void> {
  const temp = await stageWrite(path, bytes);
  try {
    // Windows refuses to replace a file while a poll or scanner still has it open.
    for (let attempt = 0; ; attempt += 1) {
      try {
        await rename(temp, path);
        return;
      } catch (error) {
        const code = error instanceof Error && "code" in error ? String(error.code) : "";
        if (attempt >= 80 || !REPLACE_RETRY.has(code)) throw error;
        await delay(15 + Math.floor(Math.random() * 40));
      }
    }
  } catch (error) {
    await rm(temp, { force: true }).catch(() => {});
    throw error;
  }
}
