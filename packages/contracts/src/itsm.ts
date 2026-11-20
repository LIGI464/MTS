import { z } from "zod";
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

const requestId = z.uuid();
const target = { requestId, id: z.string().min(1), expectedVersion: z.string().min(1) };

export const ScenarioCommandSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("create-critical"), requestId }),
  z.strictObject({ action: z.literal("escalate"), ...target }),
  z.strictObject({ action: z.literal("assign"), ...target }),
  z.strictObject({ action: z.literal("deadline"), ...target, deadline: z.iso.datetime() }),
]);

export const ResolveIncidentSchema = z.strictObject({
  requestId,
  expectedVersion: target.expectedVersion,
  solution: z.string().refine((value) => {
    const length = Array.from(value.trim()).length;
    return length >= 1 && length <= 1000;
  }),
});

export type ScenarioCommand = z.infer<typeof ScenarioCommandSchema>;
export type ResolveIncident = z.infer<typeof ResolveIncidentSchema>;
export type MutationResult = { id: string; version: string; revision: number };
