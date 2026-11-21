import { timingSafeEqual } from "node:crypto";
import type { ApiError } from "@mts/contracts";

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
