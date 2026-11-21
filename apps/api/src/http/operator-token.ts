import { timingSafeEqual } from "node:crypto";
import type { ApiError } from "@mts/contracts";
import type { onRequestHookHandler } from "fastify";

const OPERATOR_DISABLED = {
  code: "OPERATOR_DISABLED",
  message: "Операторские действия отключены.",
} satisfies ApiError;

export const INVALID_OPERATOR_TOKEN = {
  code: "OPERATOR_TOKEN_INVALID",
  message: "Требуется действующий токен оператора.",
} satisfies ApiError;

export function readBearer(header: string | undefined): string | undefined {
  return /^Bearer[ \t]+([^\s,]+)$/i.exec(header ?? "")?.[1];
}

export function isValidOperatorToken(expected: string | undefined, token: string | undefined): boolean {
  if (!expected || !token) return false;
  const left = Buffer.from(expected, "utf8");
  const right = Buffer.from(token, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

export function requireOperator(token: string | undefined): onRequestHookHandler {
  return async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    if (!token) return reply.code(404).send(OPERATOR_DISABLED);
    if (!isValidOperatorToken(token, readBearer(request.headers.authorization))) {
      return reply.code(403).send(INVALID_OPERATOR_TOKEN);
    }
  };
}
