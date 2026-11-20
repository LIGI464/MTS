/// <reference types="node" />

const DEFAULT_BASE_URL = "https://codex.sale/v1";

type ProviderConfig = {
  apiKey: string;
  model: string;
  baseUrl: string;
  timeoutMs: number;
};

type ProviderFailure = "timeout" | "provider_error" | "invalid_output";

export class ProviderError extends Error {
  constructor(
    readonly reason: ProviderFailure,
    readonly status?: number,
  ) {
    super(status === undefined ? reason : `${reason} (HTTP ${status})`);
    this.name = "ProviderError";
  }
}

export async function requestProviderText(
  { apiKey, model, baseUrl, timeoutMs }: ProviderConfig,
  input: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  let signal: AbortSignal | undefined;
  try {
    signal = AbortSignal.timeout(timeoutMs);
    const url = new URL(baseUrl.trim() || DEFAULT_BASE_URL);
    url.pathname = `${url.pathname.replace(/\/+$/u, "")}/responses`;
    url.hash = "";

    const response = await fetchImpl(url.href, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, input, stream: false }),
      redirect: "error",
      signal,
    });
    signal.throwIfAborted();
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      throw new ProviderError("provider_error", response.status);
    }

    const payload: unknown = await response.json();
    signal.throwIfAborted();
    return readOutputText(payload);
  } catch (error) {
    if (signal?.aborted) throw new ProviderError("timeout");
    if (error instanceof ProviderError) throw error;
    if (error instanceof SyntaxError) throw new ProviderError("invalid_output");
    throw new ProviderError("provider_error");
  }
}

function readOutputText(value: unknown): string {
  if (!isObject(value) || !isComplete(value)) {
    throw new ProviderError("invalid_output");
  }

  const textParts: string[] = [];
  if (Array.isArray(value.output)) {
    for (const item of value.output) {
      if (!isObject(item) || !Array.isArray(item.content)) continue;
      if (!isComplete(item)) throw new ProviderError("invalid_output");
      for (const content of item.content) {
        if (!isObject(content) || content.type !== "output_text") continue;
        if (typeof content.text !== "string") throw new ProviderError("invalid_output");
        textParts.push(content.text);
      }
    }
  }

  const flatText = typeof value.output_text === "string" ? value.output_text.trim() : "";
  const text = textParts.join("").trim() || flatText;
  if (!text) throw new ProviderError("invalid_output");
  return text;
}

function isComplete(value: Record<string, unknown>): boolean {
  return (value.status === undefined || value.status === "completed") &&
    value.incomplete_details == null && value.error == null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
