import { z } from "zod";
import { normalizeUtcInstant } from "./dates.js";
import { readExportPriority } from "./export-priority.js";

const prioritySchema = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);

const displayText = z
  .union([z.string(), z.null()])
  .optional()
  .transform((value) => {
    if (value === undefined) return undefined;
    if (value === null) return null;
    const trimmed = value.trim();
    return trimmed.length === 0 ? null : trimmed;
  });

const requiredInstant = z.string().transform((value, ctx) => {
  const normalized = normalizeUtcInstant(value);
  if (normalized === null) {
    ctx.addIssue({ code: "custom", message: "Ожидается UTC-дата" });
    return z.NEVER;
  }
  return normalized;
});

const optionalInstant = z
  .union([z.string(), z.null(), z.literal("")])
  .optional()
  .transform((value, ctx) => {
    if (value === undefined) return undefined;
    if (value === null || value === "") return null;
    const normalized = normalizeUtcInstant(value);
    if (normalized === null) {
      ctx.addIssue({ code: "custom", message: "Ожидается UTC-дата" });
      return z.NEVER;
    }
    return normalized;
  });

const optionalSignal = z
  .preprocess((value) => {
    if (value === undefined) return undefined;
    if (value === null) return null;
    if (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 4) return value;
    return null;
  }, prioritySchema.nullable())
  .optional();

const utcIso = z.string().refine((value) => normalizeUtcInstant(value) === value, "Ожидается UTC ISO");

const rawIncidentShape = z.looseObject({
  id: z.preprocess((value) => (typeof value === "string" ? value.trim() : value), z.string().min(1)),
  sysId: z.string().nullable().optional(),
  header: displayText,
  productName: displayText,
  service: displayText,
  shortDescription: displayText,
  description: displayText,
  submitDate: requiredInstant,
  deadline: optionalInstant,
  completionDate: optionalInstant,
  assignedGroupName: displayText,
  assignedEmployee: displayText,
  priorityId: prioritySchema,
  urgencyId: optionalSignal,
  impactId: optionalSignal,
  stateEnum: z.string().nullable().optional(),
  state: displayText,
  stateId: z.union([z.number(), z.string(), z.null()]).optional(),
  priority: z.union([z.string(), z.null()]).optional(),
  productUrl: z.union([z.string(), z.null()]).optional(),
});

export const RawIncidentSchema = z.preprocess((value) => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
  const row = value as Record<string, unknown>;
  const priorityId = readExportPriority(row);
  return priorityId === undefined || priorityId === row.priorityId ? value : { ...row, priorityId };
}, rawIncidentShape);

export const RawIncidentsSchema = z.array(RawIncidentSchema).superRefine((items, ctx) => {
  const seen = new Set<string>();
  items.forEach((item, index) => {
    if (seen.has(item.id)) {
      ctx.addIssue({
        code: "custom",
        message: `Повтор id ${item.id}`,
        path: [index, "id"],
      });
      return;
    }
    seen.add(item.id);
  });
});

export const StateSchema = z.enum(["Assigned", "WorkInProgress", "Resolved", "Closed", "Research", "Other"]);
export const GroupKeySchema = z.enum(["critical", "coordinator", "high", "research"]);
export const CoordinatorSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
});
export const NoticeKindSchema = z.enum([
  "critical.new",
  "coordinator.assigned",
  "coordinator.changed",
  "critical.resolved",
  "demo.reset",
]);

export const IncidentSchema = z.strictObject({
  id: z.string().min(1),
  version: z.string().min(1),
  title: z.string().min(1),
  product: z.string().nullable(),
  service: z.string().nullable(),
  team: z.string().nullable(),
  assignee: z.string().nullable(),
  coordinator: CoordinatorSchema.nullable().optional(),
  state: StateSchema,
  stateLabel: z.string().min(1),
  priority: prioritySchema,
  urgency: prioritySchema.nullable(),
  impact: prioritySchema.nullable(),
  createdAt: utcIso,
  dueAt: utcIso.nullable(),
  resolvedAt: utcIso.nullable(),
  summary: z.string().nullable(),
  itsmUrl: z.string().nullable(),
});

export const NoticeSchema = z.strictObject({
  seq: z.number().int().nonnegative(),
  kind: NoticeKindSchema,
  incidentId: z.string().nullable(),
  title: z.string().nullable(),
  at: utcIso,
});

export const SnapshotSchema = z.strictObject({
  apiVersion: z.literal(1),
  revision: z.number().int().nonnegative(),
  serverNow: utcIso,
  source: z.strictObject({
    status: z.enum(["ok", "stale", "unavailable"]),
    lastGoodAt: utcIso.nullable(),
  }),
  capabilities: z.strictObject({
    demoReset: z.boolean(),
    liveAnalysis: z.boolean(),
  }),
  incidents: z.array(IncidentSchema),
  groups: z.strictObject({
    critical: z.array(z.string()),
    coordinator: z.array(z.string()),
    high: z.array(z.string()),
    research: z.array(z.string()),
  }),
  notices: z.array(NoticeSchema).max(50),
});

export const AnalysisResultSchema = z.strictObject({
  incidentId: z.string().min(1),
  incidentVersion: z.string().min(1),
  evaluatedAt: utcIso,
  source: z.enum(["llm", "rules"]),
  summary: z.string(),
  recommendedTeam: z
    .strictObject({
      name: z.string().min(1),
      reason: z.string().min(1),
    })
    .nullable(),
  risk: z.strictObject({
    level: z.enum(["low", "medium", "high", "not_applicable"]),
    factors: z.array(z.string()),
  }),
  reason: z.enum(["rules_mode", "not_configured", "timeout", "provider_error", "invalid_output"]).nullable(),
});

export const ApiErrorSchema = z.strictObject({
  code: z.string().min(1),
  message: z.string().min(1),
});

export type RawIncident = z.infer<typeof RawIncidentSchema>;
export type RawIncidents = z.infer<typeof RawIncidentsSchema>;
export type State = z.infer<typeof StateSchema>;
export type Priority = z.infer<typeof prioritySchema>;
export type GroupKey = z.infer<typeof GroupKeySchema>;
export type NoticeKind = z.infer<typeof NoticeKindSchema>;
export type Incident = z.infer<typeof IncidentSchema>;
export type Notice = z.infer<typeof NoticeSchema>;
export type Snapshot = z.infer<typeof SnapshotSchema>;
export type AnalysisResult = z.infer<typeof AnalysisResultSchema>;
export type ApiError = z.infer<typeof ApiErrorSchema>;
