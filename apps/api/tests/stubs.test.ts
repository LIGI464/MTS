import { registerAnalysisRoutes } from "../src/analysis/index.ts";
import { ensureDemoData, registerDemoRoutes } from "../src/demo/index.ts";
import type { RouteContext } from "../src/runtime-contract.ts";
import type { FastifyInstance } from "fastify";
import { describe, expect, it } from "vitest";

describe("B00 route stubs", () => {
  it("exposes the demo and analysis registration signatures", async () => {
    await expect(ensureDemoData("data/runtime")).resolves.toBeUndefined();
    expect(registerDemoRoutes({} as FastifyInstance, {} as RouteContext)).toBeUndefined();
    expect(registerAnalysisRoutes({} as FastifyInstance, {} as RouteContext)).toBeUndefined();
  });
});
