import { z } from "zod";
import { CoordinatorSchema, IncidentSchema } from "./schemas.js";

export { CoordinatorSchema };

const nonEmpty = z.string().min(1);
const count = z.int().nonnegative();
const requestId = z.uuid();

export const CoordinatorListSchema = z.array(CoordinatorSchema);

const ticketSummary = IncidentSchema.pick({
  id: true, version: true, title: true, product: true, service: true, team: true, assignee: true,
  coordinator: true, state: true, stateLabel: true, priority: true, createdAt: true, dueAt: true, resolvedAt: true,
}).extend({ present: z.boolean(), hasSolution: z.boolean().optional() });
const ticketText = { description: z.string().nullable(), solution: z.string().nullable() };
const historyEntry = ticketSummary.pick({
  version: true, present: true, stateLabel: true, team: true, coordinator: true, dueAt: true, priority: true,
}).extend({ at: IncidentSchema.shape.createdAt, ...ticketText });
const rawFieldsShape = z.record(z.string(), z.json());
export type RawIncidentFields = z.infer<typeof rawFieldsShape>;

// Keep the input object intact, including keys such as __proto__ that Zod strips when rebuilding objects.
const rawFields = z.custom<RawIncidentFields>((value) => rawFieldsShape.safeParse(value).success);

export const FullTicketDetailSchema = z.strictObject({
  ticket: ticketSummary,
  ...ticketText,
  history: z.array(historyEntry),
  rawFields,
});

export const ImportPreviewRequestSchema = z.strictObject({ fileName: nonEmpty, jsonText: z.string() });

const previewCounts = {
  total: count,
  byPriority: z.strictObject({ 1: count, 2: count, 3: count, 4: count }),
  added: count,
  updated: count,
  archived: count,
};

export const ImportPreviewResultSchema = z.discriminatedUnion("valid", [
  z.strictObject({ valid: z.literal(false), errors: z.array(nonEmpty).min(1), ...previewCounts }),
  z.strictObject({
    valid: z.literal(true), errors: z.array(nonEmpty).length(0), ...previewCounts,
    previewId: nonEmpty, expectedRevision: count,
  }),
]);

export const ImportApplyRequestSchema = z.strictObject({ previewId: nonEmpty, expectedRevision: count, requestId });
export const ImportApplyResultSchema = z.strictObject({ revision: count });

export type Coordinator = z.infer<typeof CoordinatorSchema>;
export type CoordinatorList = z.infer<typeof CoordinatorListSchema>;
export type TicketSummary = z.infer<typeof ticketSummary>;
export type HistoryEntry = z.infer<typeof historyEntry>;
export type FullTicketDetail = z.infer<typeof FullTicketDetailSchema>;
export type ImportPreviewRequest = z.infer<typeof ImportPreviewRequestSchema>;
export type ImportPreviewResult = z.infer<typeof ImportPreviewResultSchema>;
export type ImportApplyRequest = z.infer<typeof ImportApplyRequestSchema>;
export type ImportApplyResult = z.infer<typeof ImportApplyResultSchema>;
