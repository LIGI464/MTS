import { describe, expect, it, vi } from "vitest";
import { ProviderError, requestProviderText } from "../src/provider/index.js";

const config = {
  apiKey: "fake-provider-key",
  model: "mock-model",
  baseUrl: " https://codex.sale/v1/// ",
  timeoutMs: 1000,
};

describe("codex.sale Responses transport", () => {
  it("posts once with the Responses request shape and joins the text in order", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      status: "completed",
      output: [
        { type: "reasoning" },
        {
          type: "message",
          status: "completed",
          content: [
            { type: "output_text", text: '{"summary":"Mock' },
            { type: "output_text", text: ' result"}' },
          ],
        },
      ],
    }));
    await expect(requestProviderText(config, "prepared", fetchImpl)).resolves.toBe('{"summary":"Mock result"}');
    expect(fetchImpl).toHaveBeenCalledExactlyOnceWith("https://codex.sale/v1/responses", {
      method: "POST",
      headers: { Authorization: "Bearer fake-provider-key", "Content-Type": "application/json" },
      body: JSON.stringify({ model: "mock-model", input: "prepared", stream: false }),
      redirect: "error",
      signal: expect.any(AbortSignal),
    });
  });

  it("accepts a compatible top-level output_text and defaults an empty URL", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ output_text: " Compatible " }));
    await expect(requestProviderText({ ...config, baseUrl: "" }, "prepared", fetchImpl)).resolves.toBe("Compatible");
    expect(fetchImpl.mock.calls[0]?.[0]).toBe("https://codex.sale/v1/responses");
  });

  it.each([
    { output: [] },
    { output_text: " " },
    { status: "incomplete", output_text: "partial" },
    { incomplete_details: { reason: "max_output_tokens" }, output_text: "partial" },
    { output: [{ status: "incomplete", content: [{ type: "output_text", text: "partial" }] }] },
    { output: [{ content: [{ type: "output_text", text: null }] }] },
  ])("rejects empty, incomplete and malformed output: %j", async (payload) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json(payload));
    await expect(requestProviderText(config, "prepared", fetchImpl)).rejects.toMatchObject({
      reason: "invalid_output",
    });
  });

  it("classifies non-JSON output", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response("not JSON"));
    await expect(requestProviderText(config, "prepared", fetchImpl)).rejects.toMatchObject({
      reason: "invalid_output",
    });
  });

  it.each([401, 402, 429, 500, 503])("exposes only the HTTP %i status and error category", async (status) => {
    const response = new Response("private error body containing fake-provider-key", { status });
    const readErrorBody = vi.spyOn(response, "json");
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response);
    const rejection = requestProviderText(config, "prepared", fetchImpl);
    await expect(rejection).rejects.toBeInstanceOf(ProviderError);
    await expect(rejection).rejects.toMatchObject({
      reason: "provider_error",
      status,
    });
    await expect(rejection).rejects.toThrow(`provider_error (HTTP ${status})`);
    await expect(rejection).rejects.not.toHaveProperty("cause");
    expect(readErrorBody).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("removes network error details", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new Error("private network detail"));
    const rejection = requestProviderText(config, "prepared", fetchImpl);
    await expect(rejection).rejects.toMatchObject({ reason: "provider_error" });
    await expect(rejection).rejects.toThrow(/^provider_error$/u);
    await expect(rejection).rejects.not.toHaveProperty("cause");
  });

  it("times out while receiving headers", async () => {
    const fetchImpl: typeof fetch = (_url, options) => waitForAbort<Response>(options?.signal);
    await expect(requestProviderText({ ...config, timeoutMs: 25 }, "prepared", fetchImpl))
      .rejects.toMatchObject({ reason: "timeout" });
  });

  it("uses the same timeout while reading the response body", async () => {
    const fetchImpl: typeof fetch = async (_url, options) => {
      const response = new Response();
      vi.spyOn(response, "json").mockImplementation(() => waitForAbort(options?.signal));
      return response;
    };
    await expect(requestProviderText({ ...config, timeoutMs: 25 }, "prepared", fetchImpl))
      .rejects.toMatchObject({ reason: "timeout" });
  });
});

function waitForAbort<T>(signal?: AbortSignal | null): Promise<T> {
  return new Promise((_resolve, reject) => {
    if (!signal) throw new Error("expected an abort signal");
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}
