import { randomUUID } from "node:crypto";
import { rename, rm, writeFile } from "node:fs/promises";

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
    await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => {});
    throw error;
  }
}
