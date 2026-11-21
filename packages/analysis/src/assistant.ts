import { createHash } from "node:crypto";
import {
  AssistantChatResponseSchema,
  getSlaState,
  type AssistantChatContext,
  type AssistantChatHistoryEntry,
  type AssistantChatMode,
  type AssistantChatResponse,
  type AssistantSimilarIncident,
  type Incident,
} from "@mts/contracts";
import { z } from "zod";
import {
  ASSISTANT_COMPARISON_PROMPT,
  ASSISTANT_PROMPT_VERSION,
  ASSISTANT_SYSTEM_PROMPT,
} from "./assistant-prompts.js";
import { ProviderError, requestProviderText } from "./provider/index.js";
import { cleanText, limitText, summarize, SUMMARY_LIMIT } from "./rules.js";
import type { AnalyzerConfig } from "./index.js";

type AssistantResponderConfig = AnalyzerConfig;

export type AssistantSearchStatus = "answered" | "needs_context" | "no_matches" | "incident_not_found";

export type AssistantCoverage = {
  revision: number;
  uniqueAvailable: number;
  uniqueExamined: number;
  complete: boolean;
  sources: readonly { name: string; ok: boolean }[];
};

export type AssistantActiveSimilar = {
  id: string;
  title: string;
  state: string;
  reason: string;
  href: string;
};

export type DashboardAssistantFacts = {
  overdueCount: number;
  nearCount: number;
  overdueIds: readonly string[];
  nearIds: readonly string[];
};

export type AssistantInput = {
  mode: AssistantChatMode;
  question: string;
  history: readonly AssistantChatHistoryEntry[];
  context: AssistantChatContext;
  incident: Incident | null;
  description: string | null;
  searchStatus: AssistantSearchStatus;
  matches: readonly AssistantSimilarIncident[];
  activeSimilar: readonly AssistantActiveSimilar[];
  coverage: AssistantCoverage | null;
  compareWith: Incident | null;
  compareDescription: string | null;
  compareNotFound: string | null;
  dashboardFacts: DashboardAssistantFacts | null;
  useComparisonPrompt: boolean;
  now: string;
};

export type PreparedAssistant = {
  key: string;
  rules: AssistantChatResponse;
  caseFacts: Readonly<Record<string, unknown>>;
  allowedEvidenceIds: readonly string[];
  useComparisonPrompt: boolean;
};

export type AssistantResponder = {
  prepare(input: AssistantInput): PreparedAssistant;
  run(prepared: PreparedAssistant, options: { useLive: boolean }): Promise<AssistantChatResponse>;
};

const modelSummary = z.string().transform(cleanText).pipe(z.string().min(1).max(600));
const modelSteps = z.array(z.string().transform(cleanText).pipe(z.string().min(1).max(220))).max(3);
const modelEvidenceIds = z.array(z.string().min(1)).max(20);
const modelOutput = z.strictObject({
  summary: modelSummary,
  nextSteps: modelSteps,
  evidenceIds: modelEvidenceIds,
});

function stateLabel(state: "Resolved" | "Closed"): string {
  return state === "Closed" ? "Завершён" : "Решён";
}

function formatResolvedAt(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric" }).format(date);
}

function formatDueAt(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
  }).format(date);
}

function commonSolutionTheme(matches: readonly AssistantSimilarIncident[]): string | null {
  const solutions = matches.map(({ solution }) => cleanText(solution ?? "")).filter(Boolean);
  if (solutions.length === 0) return null;
  const [first] = solutions;
  if (solutions.every((entry) => entry === first)) return first;
  const restart = solutions.filter((entry) => /перезапуск|перезапуст/i.test(entry)).length;
  if (restart >= Math.ceil(solutions.length / 2)) return "в обоих случаях помог перезапуск службы";
  return null;
}

function incidentDueSummary(incident: Incident, now: string): string | null {
  const dueLabel = formatDueAt(incident.dueAt);
  if (!dueLabel) return "Срок по заявке не задан.";
  const sla = getSlaState(incident, Date.parse(now));
  if (sla === "overdue") return `Срок истёк ${dueLabel}.`;
  if (sla === "near") return `Срок близко: ${dueLabel}.`;
  if (sla === "done") return `Заявка завершена, срок был ${dueLabel}.`;
  return `Срок по заявке: ${dueLabel}.`;
}

function buildRulesResponse(input: AssistantInput): AssistantChatResponse {
  const {
    mode, question, context, incident, description, searchStatus, matches, now,
    compareNotFound, dashboardFacts, coverage,
  } = input;

  if (compareNotFound) {
    return AssistantChatResponseSchema.parse({
      mode,
      status: "incident_not_found",
      evaluatedAt: now,
      source: "rules",
      reason: "rules_mode",
      context,
      summary: `Заявка ${compareNotFound} не найдена в данных приложения. Проверьте номер второй записи.`,
      nextSteps: ["Уточните ID заявки для сравнения."],
      matches: [],
    });
  }

  if (searchStatus === "needs_context") {
    const followUp = question
      ? "Что именно не работает и в каком сервисе?"
      : "Укажите ID инцидента или опишите симптомы.";
    return AssistantChatResponseSchema.parse({
      mode,
      status: "needs_context",
      evaluatedAt: now,
      source: "rules",
      reason: "rules_mode",
      context,
      summary: followUp,
      nextSteps: question ? [followUp] : ["Введите номер инцидента или опишите симптомы в одном сообщении."],
      matches: [],
    });
  }

  if (searchStatus === "incident_not_found") {
    const unknownId = context.incidentId ?? "указанный";
    return AssistantChatResponseSchema.parse({
      mode,
      status: "incident_not_found",
      evaluatedAt: now,
      source: "rules",
      reason: "rules_mode",
      context,
      summary: `Инцидент ${unknownId} не найден в данных приложения.`,
      nextSteps: ["Проверьте номер инцидента и повторите запрос."],
      matches: [],
    });
  }

  const cardSummary = incident ? summarize(incident, cleanText(description ?? "")) : null;
  const trimmedQuestion = cleanText(question);
  const asksDue = /когда срок|какой срок|срок\?/iu.test(trimmedQuestion);
  const asksWhy = /почему|причин/iu.test(trimmedQuestion);
  const asksOverdue = /просроч/iu.test(trimmedQuestion);

  if (mode === "dashboard" && asksOverdue && dashboardFacts) {
    const summary = dashboardFacts.overdueCount === 0
      ? "Просроченных активных заявок в текущем снимке нет."
      : `В снимке ${dashboardFacts.overdueCount} просроченных заявок.`;
  const steps = dashboardFacts.overdueIds.slice(0, 3).map((id) => `Откройте ${id} и проверьте срок.`);
    return AssistantChatResponseSchema.parse({
      mode,
      status: "answered",
      evaluatedAt: now,
      source: "rules",
      reason: "rules_mode",
      context,
      summary,
      nextSteps: steps.length > 0 ? steps : ["Откройте группу «Просрочены» на пульте."],
      matches: [],
    });
  }

  if (incident && asksDue) {
    const dueText = incidentDueSummary(incident, now);
    return AssistantChatResponseSchema.parse({
      mode,
      status: "answered",
      evaluatedAt: now,
      source: "rules",
      reason: "rules_mode",
      context,
      summary: dueText ?? "Срок не удалось определить по доступным полям.",
      nextSteps: cardSummary ? [`По симптомам: ${limitText(cardSummary, SUMMARY_LIMIT)}.`] : [],
      matches: [],
    });
  }

  if (incident && asksWhy) {
    return AssistantChatResponseSchema.parse({
      mode,
      status: searchStatus === "no_matches" ? "no_matches" : "answered",
      evaluatedAt: now,
      source: "rules",
      reason: "rules_mode",
      context,
      summary: "В принятой версии заявки нет подтверждённой причины сбоя — опирайтесь на описание и проверки по сервису.",
      nextSteps: cardSummary
        ? [`Сверьте описание: ${limitText(cardSummary, SUMMARY_LIMIT)}.`]
        : ["Уточните наблюдаемый симптом и соберите логи сервиса."],
      matches: [],
    });
  }

  if (searchStatus === "no_matches") {
    const coverageNote = coverage?.complete
      ? ` Проверено ${coverage.uniqueExamined} из ${coverage.uniqueAvailable} уникальных записей.`
      : "";
    return AssistantChatResponseSchema.parse({
      mode,
      status: "no_matches",
      evaluatedAt: now,
      source: "rules",
      reason: "rules_mode",
      context,
      summary: incident
        ? `Для инцидента ${incident.id} подходящих завершённых аналогов в архиве не найдено.${coverageNote}`
        : `Подходящих завершённых инцидентов не найдено.${coverageNote}`,
      nextSteps: cardSummary
        ? [`Из карточки: ${limitText(cardSummary, SUMMARY_LIMIT)}.`, "Уточните сервис или симптом, чтобы сузить поиск."]
        : ["Уточните сервис или симптом, чтобы сузить поиск."],
      matches: [],
    });
  }

  const count = matches.length;
  const theme = commonSolutionTheme(matches);
  const intro = count === 1
    ? "Найден 1 завершённый инцидент."
    : `Найдено ${count} завершённых инцидента.`;
  const tail = theme ? ` ${theme.endsWith(".") ? theme : `${theme}.`}` : "";
  const summaryParts = [intro + tail];
  if (cardSummary) summaryParts.push(`Из карточки: ${limitText(cardSummary, SUMMARY_LIMIT)}.`);
  if (question) summaryParts.push(`Ваш вопрос: ${limitText(trimmedQuestion, 220)}.`);

  const nextSteps: string[] = [];
  if (cardSummary) nextSteps.push(`Что проверить по текущей заявке: ${limitText(cardSummary, SUMMARY_LIMIT)}.`);
  for (const match of matches.slice(0, 2)) {
    const date = formatResolvedAt(match.resolvedAt);
    const details = [
      match.symptom ? `Симптом — ${limitText(match.symptom, 180)}.` : null,
      match.solution ? `Решение — ${limitText(match.solution, 220)}.` : null,
      `${stateLabel(match.state)}${date ? `, ${date}` : ""}: ${match.title}.`,
    ].filter(Boolean);
    nextSteps.push(details.join(" "));
  }
  if (nextSteps.length === 0) nextSteps.push("Сверьте симптомы с карточками аналогов и проверьте описанные действия.");

  return AssistantChatResponseSchema.parse({
    mode,
    status: "answered",
    evaluatedAt: now,
    source: "rules",
    reason: "rules_mode",
    context,
    summary: limitText(summaryParts.join(" "), 2_000),
    nextSteps: nextSteps.slice(0, 5),
    matches,
  });
}

function collectAllowedEvidenceIds(input: AssistantInput): string[] {
  const ids = new Set<string>();
  if (input.incident) ids.add(input.incident.id);
  if (input.compareWith) ids.add(input.compareWith.id);
  for (const match of input.matches) ids.add(match.id);
  for (const active of input.activeSimilar) ids.add(active.id);
  if (input.dashboardFacts) {
    for (const id of input.dashboardFacts.overdueIds) ids.add(id);
    for (const id of input.dashboardFacts.nearIds) ids.add(id);
  }
  return [...ids];
}

export function createAssistantResponder(config: AssistantResponderConfig): AssistantResponder {
  const apiKey = config.apiKey?.trim();
  const model = config.model?.trim();

  return {
    prepare(input) {
      const rules = buildRulesResponse(input);
      const allowedEvidenceIds = Object.freeze(collectAllowedEvidenceIds(input));
      const caseFacts = Object.freeze({
        promptVersion: ASSISTANT_PROMPT_VERSION,
        mode: input.mode,
        status: rules.status,
        question: limitText(cleanText(input.question), 500) || null,
        history: input.history.map((entry) => Object.freeze({ role: entry.role, text: limitText(cleanText(entry.text), 900) })),
        incident: input.incident
          ? {
              id: input.incident.id,
              title: limitText(cleanText(input.incident.title), SUMMARY_LIMIT),
              product: input.incident.product,
              service: input.incident.service,
              state: input.incident.state,
              stateLabel: input.incident.stateLabel,
              priority: input.incident.priority,
              dueAt: input.incident.dueAt,
              createdAt: input.incident.createdAt,
              sla: getSlaState(input.incident, Date.parse(input.now)),
              summary: input.incident.summary,
              description: limitText(cleanText(input.description ?? ""), 900) || null,
            }
          : null,
        compareWith: input.compareWith
          ? {
              id: input.compareWith.id,
              title: limitText(cleanText(input.compareWith.title), SUMMARY_LIMIT),
              product: input.compareWith.product,
              service: input.compareWith.service,
              state: input.compareWith.state,
              stateLabel: input.compareWith.stateLabel,
              description: limitText(cleanText(input.compareDescription ?? ""), 900) || null,
            }
          : null,
        context: input.context,
        coverage: input.coverage,
        dashboard: input.dashboardFacts,
        matches: input.matches.map((match) => Object.freeze({
          id: match.id,
          title: match.title,
          state: match.state,
          symptom: match.symptom,
          solution: match.solution,
          reason: match.reason,
        })),
        activeSimilar: input.activeSimilar.map((match) => Object.freeze({ ...match })),
      });
      const key = createHash("sha256")
        .update(JSON.stringify([
          input.mode,
          input.context,
          input.history,
          caseFacts,
          ASSISTANT_PROMPT_VERSION,
          input.useComparisonPrompt,
        ]))
        .digest("hex");
      return {
        key,
        rules: Object.freeze(rules),
        caseFacts,
        allowedEvidenceIds,
        useComparisonPrompt: input.useComparisonPrompt,
      };
    },
    async run(prepared, { useLive }) {
      if (!useLive) return prepared.rules;
      if (!apiKey || !model) return { ...prepared.rules, reason: "not_configured" };

      const instructions = prepared.useComparisonPrompt
        ? `${ASSISTANT_SYSTEM_PROMPT}\n\n${ASSISTANT_COMPARISON_PROMPT}`
        : ASSISTANT_SYSTEM_PROMPT;

      try {
        const input = JSON.stringify({
          question: prepared.caseFacts.question,
          history: prepared.caseFacts.history,
          facts: {
            mode: prepared.caseFacts.mode,
            status: prepared.caseFacts.status,
            incident: prepared.caseFacts.incident,
            compareWith: prepared.caseFacts.compareWith,
            coverage: prepared.caseFacts.coverage,
            dashboard: prepared.caseFacts.dashboard,
            matches: prepared.caseFacts.matches,
            activeSimilar: prepared.caseFacts.activeSimilar,
            context: prepared.caseFacts.context,
          },
        });
        const text = await requestProviderText(
          { ...config, apiKey, model },
          { instructions, input },
        );
        const output = modelOutput.safeParse(JSON.parse(text));
        if (!output.success) return { ...prepared.rules, reason: "invalid_output" };

        const allowed = new Set(prepared.allowedEvidenceIds);
        const evidenceIds = output.data.evidenceIds.filter((id) => allowed.has(id));
        if (evidenceIds.length !== output.data.evidenceIds.length) {
          return { ...prepared.rules, reason: "invalid_output" };
        }

        return AssistantChatResponseSchema.parse({
          ...prepared.rules,
          source: "llm",
          reason: null,
          summary: output.data.summary,
          nextSteps: output.data.nextSteps,
        });
      } catch (error) {
        const reason = error instanceof ProviderError ? error.reason :
          error instanceof SyntaxError ? "invalid_output" : "provider_error";
        return { ...prepared.rules, reason };
      }
    },
  };
}