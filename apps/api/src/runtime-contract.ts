import type { CoordinatorList, FullTicketDetail, MutationResult, Snapshot, TicketList } from "@mts/contracts";
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
  listCoordinators(): CoordinatorList;
  listTickets(): TicketList;
  getTicket(id: string): FullTicketDetail | null;
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
