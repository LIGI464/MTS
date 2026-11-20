import type { FastifyInstance } from "fastify";
import type { RouteContext } from "../runtime-contract.js";

export async function ensureDemoData(_dataDir: string): Promise<void> {}

export function registerDemoRoutes(_app: FastifyInstance, _context: RouteContext): void {}
