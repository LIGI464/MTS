import { AnalysisResultSchema, type AnalysisResult, type Incident } from "@mts/contracts";

export type AnalyzerConfig = {
  apiKey?: string;
  model?: string;
  baseUrl: string;
  timeoutMs: number;
};

export type AnalysisInput = {
  incident: Incident;
  description: string | null;
  history: readonly Incident[];
  now: string;
};

export type PreparedAnalysis = {
  key: string;
  rules: AnalysisResult;
  caseFacts: Readonly<Record<string, unknown>>;
  candidateNames: readonly string[];
};

export type Analyzer = {
  prepare(input: AnalysisInput): PreparedAnalysis;
  run(prepared: PreparedAnalysis, options: { useLive: boolean }): Promise<AnalysisResult>;
};

export function createAnalyzer(_config: AnalyzerConfig): Analyzer {
  return {
    prepare(input) {
      const summary = input.incident.summary ?? firstText(input.description) ?? input.incident.title;
      const rules = AnalysisResultSchema.parse({
        incidentId: input.incident.id,
        incidentVersion: input.incident.version,
        evaluatedAt: input.now,
        source: "rules",
        summary,
        recommendedTeam: null,
        risk: {
          level: "low",
          factors: ["По полям выгрузки повышающих факторов не видно"],
        },
        reason: "rules_mode",
      });
      return {
        key: `${input.incident.id}:${input.incident.version}:rules`,
        rules,
        caseFacts: {
          id: input.incident.id,
          title: input.incident.title,
          product: input.incident.product,
          service: input.incident.service,
        },
        candidateNames: [],
      };
    },
    async run(prepared) {
      return prepared.rules;
    },
  };
}

function firstText(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}
