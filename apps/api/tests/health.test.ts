import { createApp } from "../src/start.ts";
import { describe, expect, it } from "vitest";

describe("API stub", () => {
  it("answers /healthz while the runtime has no data", async () => {
    const app = createApp();
    const response = await app.inject({ method: "GET", url: "/healthz" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok", source: "unavailable" });
    await app.close();
  });
});
