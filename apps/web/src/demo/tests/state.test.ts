import { describe, expect, it } from "vitest";
import { isTokenError, reduceReset, tokenRejectedMessage } from "../state";

describe("reduceReset", () => {
  it("rejects a token and ignores a repeated submit while pending", () => {
    const pending = reduceReset({ phase: "confirm", message: null }, { type: "submit" });
    expect(pending.phase).toBe("pending");
    expect(reduceReset(pending, { type: "submit" })).toBe(pending);
    const rejected = reduceReset(pending, { type: "token-rejected" });
    expect(rejected.phase).toBe("error");
    expect(rejected.message).toBe(tokenRejectedMessage);
  });

  it("records a successful reset", () => {
    const done = reduceReset({ phase: "pending", message: null }, { type: "success" });
    expect(done).toEqual({ phase: "done", message: "Набор восстановлен" });
  });
});

describe("isTokenError", () => {
  it("recognises the operator token code", () => {
    expect(isTokenError({ code: "OPERATOR_TOKEN_INVALID", message: "отказ" })).toBe(true);
    expect(isTokenError(new Error("Нужен операторский токен"))).toBe(true);
    expect(isTokenError(new Error("Сеть недоступна"))).toBe(false);
  });
});