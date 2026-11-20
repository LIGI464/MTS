import type { Incident } from "./schemas.js";

export type TicketSummary = Pick<Incident,
  | "id" | "version" | "title" | "product" | "service" | "team" | "assignee"
  | "state" | "stateLabel" | "priority" | "createdAt" | "dueAt" | "resolvedAt"
> & {
  present: boolean;
  hasSolution?: boolean;
};

export type HistoryEntry = Pick<TicketSummary, "version" | "present" | "stateLabel" | "team" | "dueAt" | "priority"> & {
  at: string;
  description: string | null;
  solution: string | null;
};

export type TicketList = { items: TicketSummary[] };

export type TicketDetail = Pick<HistoryEntry, "description" | "solution"> & {
  ticket: TicketSummary;
  history: HistoryEntry[];
};
