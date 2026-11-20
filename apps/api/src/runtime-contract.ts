import type { MutationResult, Snapshot, TicketDetail, TicketList } from "@mts/contracts";
import type { ItsmCommand } from "./itsm/mutation.js";

export type DashboardRuntimeOptions = {
  dataDir: string;
  pollMs: number;
  itsmTemplate?: string;
  capabilities: Snapshot["capabilities"];
};

export type DashboardRuntime = {
  getSnapshot(): Snapshot;
  getDescription(id: string): string | null;
  listTickets(): TicketList;
  getTicket(id: string): TicketDetail | null;
  mutate(command: ItsmCommand): Promise<MutationResult>;
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
