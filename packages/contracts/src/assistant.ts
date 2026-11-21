import { z } from "zod";
import { utcIso } from "./schemas.js";

const trimmedQuestion = z
  .string()
  .max(2_000)
  .transform((value) => value.replace(/\p{Cc}/gu, " ").replace(/\s+/gu, " ").trim());

const boundedText = (max: number) =>
  z
    .string()
    .max(max)
    .transform((value) => value.replace(/\p{Cc}/gu, " ").replace(/\s+/gu, " ").trim());

export const AssistantChatModeSchema = z.enum(["incident", "dashboard"]);
export const AssistantSearchStatusSchema = z.enum(["answered", "needs_context", "no_matches", "incident_not_found"]);
export const AssistantSourceSchema = z.enum(["llm", "rules"]);
export const AssistantFallbackReasonSchema = z
  .enum(["rules_mode", "not_configured", "timeout", "provider_error", "invalid_output"])
  .nullable();

export const AssistantSimilarIncidentSchema = z.strictObject({
  id: z.string().min(1),
  version: z.string().min(1),
  title: z.string().min(1),
  state: z.enum(["Resolved", "Closed"]),
  resolvedAt: utcIso.nullable(),
  present: z.boolean(),
  symptom: z.string().nullable(),
  solution: z.string().nullable(),
  reason: z.string().min(1),
  href: z.string().min(1),
});

export const AssistantChatContextSchema = z.strictObject({
  incidentId: z.string().min(1).optional(),
  incidentVersion: z.string().min(1).optional(),
  symptoms: boundedText(2_000).optional(),
});

export const AssistantChatRequestSchema = z.strictObject({
  mode: AssistantChatModeSchema,
  question: trimmedQuestion.optional().default(""),
  context: AssistantChatContextSchema.optional().default({}),
});

export const AssistantChatResponseSchema = z.strictObject({
  mode: AssistantChatModeSchema,
  status: AssistantSearchStatusSchema,
  evaluatedAt: utcIso,
  source: AssistantSourceSchema,
  reason: AssistantFallbackReasonSchema,
  context: AssistantChatContextSchema,
  summary: z.string().min(1),
  nextSteps: z.array(z.string().min(1).max(500)).max(8),
  matches: z.array(AssistantSimilarIncidentSchema).max(5),
});

export type AssistantChatMode = z.infer<typeof AssistantChatModeSchema>;
export type AssistantSearchStatus = z.infer<typeof AssistantSearchStatusSchema>;
export type AssistantSimilarIncident = z.infer<typeof AssistantSimilarIncidentSchema>;
export type AssistantChatContext = z.infer<typeof AssistantChatContextSchema>;
export type AssistantChatRequest = z.infer<typeof AssistantChatRequestSchema>;
export type AssistantChatResponse = z.infer<typeof AssistantChatResponseSchema>;