import type {
  CoordinatorList, FullTicketDetail, ImportApplyRequest, ImportApplyResult, ImportPreviewRequest, ImportPreviewResult,
  MutationResult, Snapshot, TicketList,
} from "@mts/contracts";
import type { SimilarIncidentsQuery, SimilarIncidentsResult } from "./assistant/matches.js";
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
  findSimilarIncidents(query: SimilarIncidentsQuery): SimilarIncidentsResult;
  mutate(command: ItsmCommand): Promise<MutationResult>;
  previewImport(command: ImportPreviewRequest): ImportPreviewResult;
  applyImport(command: ImportApplyRequest): Promise<ImportApplyResult>;
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
