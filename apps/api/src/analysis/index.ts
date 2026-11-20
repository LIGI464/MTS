import type { AnalyzerConfig } from "@mts/analysis";
import type { FastifyInstance } from "fastify";
import type { RouteContext } from "../runtime-contract.js";

export function registerAnalysisRoutes(_app: FastifyInstance, _context: RouteContext): void {
  const _analyzer: AnalyzerConfig["baseUrl"] | undefined = undefined;
  void _analyzer;
}
