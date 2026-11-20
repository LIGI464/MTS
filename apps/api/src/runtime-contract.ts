import type { Snapshot } from "@mts/contracts";

export type DashboardRuntimeOptions = {
  dataDir: string;
  pollMs: number;
  itsmTemplate?: string;
  capabilities: Snapshot["capabilities"];
};

export type DashboardRuntime = {
  getSnapshot(): Snapshot;
  getDescription(id: string): string | null;
  subscribe(listener: (snapshot: Snapshot) => void): () => void;
  resetTo(bytes: Uint8Array): Promise<Snapshot>;
  close(): Promise<void>;
};

export type RouteContext = {
  runtime: DashboardRuntime;
  dataDir: string;
  operatorToken?: string;
  env: NodeJS.ProcessEnv;
};
