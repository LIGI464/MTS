import { API_PREFIX, SnapshotSchema } from "@mts/contracts";
import { z } from "zod";
import {
  failureText,
  type FailureKind,
  type Intent,
  type MutationReceipt,
} from "./model";

const receiptSchema = z.strictObject({
  id: z.string().min(1),
  version: z.string().min(1),
  revision: z.number().int().nonnegative(),
});

const ticketSchema = z.object({
  ticket: z.object({
    version: z.string().min(1),
    stateLabel: z.string().min(1),
  }).passthrough(),
}).passthrough();

export class DeveloperRequestError extends Error {
  readonly kind: FailureKind;

  constructor(kind: FailureKind) {
    super(failureText(kind));
    this.name = "DeveloperRequestError";
    this.kind = kind;
  }
}

export type DeveloperTransport = {
  send(intent: Intent, token: string): Promise<MutationReceipt>;
  reload(id: string): Promise<{ version: string; stateLabel: string } | null>;
  reset(token: string): Promise<void>;
};

export function createDeveloperTransport(fetchImpl: typeof fetch): DeveloperTransport {
  return {
    send: (intent, token) => sendCommand(fetchImpl, intent, token),
    reload: (id) => reloadTicket(fetchImpl, id),
    reset: (token) => resetBaseline(fetchImpl, token),
  };
}

export async function sendCommand(fetchImpl: typeof fetch, intent: Intent, token: string): Promise<MutationReceipt> {
  const response = await request(fetchImpl, commandUrl(intent), token, commandBody(intent));
  if (!response.ok) throw new DeveloperRequestError(kindForStatus(response.status));
  const parsed = receiptSchema.safeParse(await readJson(response));
  if (!parsed.success) throw new DeveloperRequestError("unconfirmed");
  return parsed.data;
}

export async function reloadTicket(
  fetchImpl: typeof fetch,
  id: string,
): Promise<{ version: string; stateLabel: string } | null> {
  let response: Response;
  try {
    response = await fetchImpl(`${API_PREFIX}/itsm/incidents/${encodeURIComponent(id)}`);
  } catch {
    return null;
  }
  if (!response.ok) return null;
  const parsed = ticketSchema.safeParse(await readJson(response));
  if (!parsed.success) return null;
  return { version: parsed.data.ticket.version, stateLabel: parsed.data.ticket.stateLabel };
}

export function commandBody(intent: Intent): Record<string, string> {
  if (intent.action === "create-critical") return { action: intent.action, requestId: intent.requestId };
  if (intent.action === "resolve") {
    return {
      requestId: intent.requestId,
      expectedVersion: intent.expectedVersion ?? "",
      solution: intent.solution ?? "",
    };
  }
  const body: Record<string, string> = {
    action: intent.action,
    requestId: intent.requestId,
    id: intent.id ?? "",
    expectedVersion: intent.expectedVersion ?? "",
  };
  if (intent.action === "deadline") body.deadline = intent.deadline ?? "";
  return body;
}

export function commandUrl(intent: Intent): string {
  if (intent.action === "resolve") return `${API_PREFIX}/itsm/incidents/${encodeURIComponent(intent.id ?? "")}/resolve`;
  return `${API_PREFIX}/dev/scenarios`;
}

function kindForStatus(status: number): FailureKind {
  if (status === 400) return "bad";
  if (status === 403) return "token";
  if (status === 404) return "missing";
  if (status === 409) return "conflict";
  return "unconfirmed";
}

async function resetBaseline(fetchImpl: typeof fetch, token: string): Promise<void> {
  const response = await request(fetchImpl, `${API_PREFIX}/demo/reset`, token, null);
  if (!response.ok) throw new DeveloperRequestError(kindForStatus(response.status));
  const parsed = SnapshotSchema.safeParse(await readJson(response));
  if (!parsed.success) throw new DeveloperRequestError("unconfirmed");
}

async function request(fetchImpl: typeof fetch, url: string, token: string, body: Record<string, string> | null): Promise<Response> {
  try {
    return await fetchImpl(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new DeveloperRequestError("network");
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}
