import type { AnalysisResult, Incident } from "@mts/contracts";
import { describe, expect, it } from "vitest";
import { analysisView, reduceAnalysis } from "../state";

function incident(id: string, version: string): Pick<Incident, "id" | "version"> {
  return { id, version };
}

function result(id: string, version: string): AnalysisResult {
  return {
    incidentId: id,
    incidentVersion: version,
    evaluatedAt: "2026-01-15T09:00:00.000Z",
    source: "rules",
    summary: "Кратко",
    recommendedTeam: null,
    risk: { level: "low", factors: [] },
    reason: "rules_mode",
  };
}

describe("reduceAnalysis", () => {
  it("drops a stale response after the incident version changes", () => {
    let state = reduceAnalysis(analysisView(incident("A", "1")), { type: "start" });
    state = reduceAnalysis(state, { type: "reset", incident: incident("A", "2") });
    expect(state.phase).toBe("idle");
    expect(state.result).toBeNull();
    const stale = reduceAnalysis(state, { type: "success", result: result("A", "1") });
    expect(stale.phase).toBe("idle");
    expect(stale.result).toBeNull();
  });

  it("ignores a response for another id while the request is pending", () => {
    const state = reduceAnalysis(analysisView(incident("A", "1")), { type: "start" });
    const stale = reduceAnalysis(state, { type: "success", result: result("B", "1") });
    expect(stale.result).toBeNull();
    expect(stale.phase).toBe("idle");
  });

  it("ignores a second start while a request is pending", () => {
    const pending = reduceAnalysis(analysisView(incident("A", "1")), { type: "start" });
    expect(reduceAnalysis(pending, { type: "start" })).toBe(pending);
  });
});
