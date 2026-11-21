import { z } from "zod";
import type { AssignCoordinatorResult, FullTicketDetail, TicketSummary } from "./incident-workflow.js";

export type { HistoryEntry, TicketSummary } from "./incident-workflow.js";

export type TicketList = { items: TicketSummary[] };

export type TicketDetail = Omit<FullTicketDetail, "rawFields"> & Partial<Pick<FullTicketDetail, "rawFields">>;

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
export type MutationResult = AssignCoordinatorResult;
