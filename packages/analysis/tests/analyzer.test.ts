import { createAnalyzer } from "@mts/analysis";
import { AnalysisResultSchema, makeMockTimeline } from "@mts/contracts";
import { describe, expect, it } from "vitest";

describe("rules analyzer stub", () => {
  it("returns a valid rules result without calling a provider", async () => {
    const incident = makeMockTimeline(Date.parse("2026-01-15T09:00:00.000Z")).initial.incidents[0];
    if (!incident) throw new Error("mock incident is missing");
    const analyzer = createAnalyzer({ baseUrl: "https://codex.sale/v1", timeoutMs: 8000 });
    const prepared = analyzer.prepare({
      incident,
      description: "Полное описание для анализа",
      history: [],
      now: "2026-01-15T09:00:00.000Z",
    });
    const ruled = await analyzer.run(prepared, { useLive: false });
    const liveAttempt = await analyzer.run(prepared, { useLive: true });

    expect(AnalysisResultSchema.parse(ruled).source).toBe("rules");
    expect(ruled.reason).toBe("rules_mode");
    expect(ruled.incidentId).toBe(incident.id);
    expect(ruled.incidentVersion).toBe(incident.version);
    expect(liveAttempt).toEqual(ruled);
    expect(prepared.candidateNames).toEqual([]);
  });
});
