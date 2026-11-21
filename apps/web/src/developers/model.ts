export const ACTION_ORDER = [
  "create-critical",
  "escalate",
  "deadline",
  "resolve",
] as const;

export type DeveloperAction = (typeof ACTION_ORDER)[number];

export const ACTION_LABELS: Record<DeveloperAction, string> = {
  "create-critical": "Добавить критический",
  escalate: "Повысить приоритет",
  deadline: "Изменить срок",
  resolve: "Записать решение",
};

export const messages = {
  confirmed: (id: string) => `Запись подтверждена. ID ${id}.`,
  emptySolution: "Нужен непустой текст решения",
  longSolution: "Решение длиннее 1000 символов",
  needIncident: "Выберите заявку",
  needDeadline: "Укажите время срока",
  badRequest: "Запрос отклонён: проверьте поля",
  token: "Операторский токен не принят",
  missing: "Запись или сценарий не найдены",
  conflict: "Версия устарела. Запись перечитана, текст решения сохранён",
  network: "Соединение прервано. Повтор отправит тот же запрос",
  unconfirmed: "Сервер не подтвердил запись",
  mock: "В dev:web запись не выполняется: нет файла, SSE и реестра. Форма показывает сценарии, но не отправляет их.",
  read: "Чтобы включить сценарии, задайте MTS_OPERATOR_TOKEN на сервере.",
  resetDone: "Набор восстановлен. История ITSM сохранена.",
  sourceOk: "Источник актуален",
  sourceStale: "Показан последний сохранённый снимок. Источник устарел.",
  sourceUnavailable: "Файл временно недоступен",
  standLive: "Стенд записи",
} as const;

export type DeveloperMode = "live" | "mock" | "read";

export function developerMode(input: { mock: boolean; demoReset: boolean }): DeveloperMode {
  if (input.mock) return "mock";
  if (!input.demoReset) return "read";
  return "live";
}

export type Intent = {
  requestId: string;
  action: DeveloperAction;
  id: string | null;
  expectedVersion: string | null;
  solution: string | null;
  deadline: string | null;
};

export type JournalEntry = {
  at: string;
  id: string | null;
  text: string;
};

export type MutationReceipt = {
  id: string;
  version: string;
  revision: number;
};

export type Session = {
  phase: "idle" | "pending" | "done" | "error";
  selectedId: string | null;
  solution: string;
  deadlineChoice: "plus90" | "custom";
  customDeadline: string;
  lastAction: DeveloperAction | null;
  message: string | null;
  receipt: MutationReceipt | null;
  retry: Intent | null;
  pending: Intent | null;
  journal: JournalEntry[];
  versionOverride: Record<string, string>;
};

export function createSession(): Session {
  return {
    phase: "idle",
    selectedId: null,
    solution: "",
    deadlineChoice: "plus90",
    customDeadline: "",
    lastAction: null,
    message: null,
    receipt: null,
    retry: null,
    pending: null,
    journal: [],
    versionOverride: {},
  };
}

export function selectIncident(state: Session, id: string | null): Session {
  if (state.phase === "pending") return state;
  return { ...state, selectedId: id };
}

export function editSolution(state: Session, solution: string): Session {
  if (state.phase === "pending") return state;
  return { ...state, solution };
}

export function chooseDeadline(state: Session, choice: "plus90" | "custom", customDeadline = state.customDeadline): Session {
  if (state.phase === "pending") return state;
  return { ...state, deadlineChoice: choice, customDeadline };
}

type KnownIncident = { id: string; version: string };

export function prepareSubmit(
  state: Session,
  input: {
    action: DeveloperAction;
    requestId: string;
    nowMs: number;
    at: string;
    incidents: KnownIncident[];
  },
): { state: Session; intent: Intent | null } {
  if (state.phase === "pending") return { state, intent: null };

  const selected = state.selectedId;
  const known = selected ? input.incidents.find((item) => item.id === selected) : undefined;
  const expectedVersion = selected ? state.versionOverride[selected] ?? known?.version ?? null : null;
  const needsIncident = input.action !== "create-critical";
  if (needsIncident && (!selected || !expectedVersion)) {
    return { state: reject(state, messages.needIncident, input.at, selected), intent: null };
  }

  let solution: string | null = null;
  if (input.action === "resolve") {
    solution = state.solution.trim();
    if (solution.length === 0) return { state: reject(state, messages.emptySolution, input.at, selected), intent: null };
    if (solution.length > 1000) return { state: reject(state, messages.longSolution, input.at, selected), intent: null };
  }

  let deadline: string | null = null;
  if (input.action === "deadline") {
    if (state.deadlineChoice === "plus90") {
      deadline = new Date(input.nowMs + 90_000).toISOString();
    } else {
      const parsed = Date.parse(state.customDeadline);
      if (Number.isNaN(parsed)) return { state: reject(state, messages.needDeadline, input.at, selected), intent: null };
      deadline = new Date(parsed).toISOString();
    }
  }

  const draft: Omit<Intent, "requestId"> = {
    action: input.action,
    id: needsIncident ? selected : null,
    expectedVersion: needsIncident ? expectedVersion : null,
    solution,
    deadline,
  };
  const requestId = state.retry && sameDraft(state.retry, draft) ? state.retry.requestId : input.requestId;
  const intent: Intent = { requestId, ...draft };
  return {
    state: {
      ...state,
      phase: "pending",
      lastAction: input.action,
      message: null,
      pending: intent,
      retry: null,
    },
    intent,
  };
}

export function applySuccess(state: Session, receipt: MutationReceipt, at: string): Session {
  if (state.phase !== "pending" || !state.pending) return state;
  const text = messages.confirmed(receipt.id);
  return {
    ...state,
    phase: "done",
    selectedId: state.pending.action === "create-critical" ? receipt.id : state.selectedId,
    message: text,
    receipt,
    pending: null,
    retry: null,
    versionOverride: { ...state.versionOverride, [receipt.id]: receipt.version },
    journal: [...state.journal, { at, id: receipt.id, text }],
  };
}

export type FailureKind = "bad" | "token" | "missing" | "conflict" | "network" | "unconfirmed";

export function applyFailure(
  state: Session,
  kind: FailureKind,
  at: string,
  freshVersion: string | null = null,
): Session {
  if (state.phase !== "pending" || !state.pending) return state;
  const text = failureText(kind);
  const versionOverride = { ...state.versionOverride };
  if (kind === "conflict" && state.pending.id && freshVersion) versionOverride[state.pending.id] = freshVersion;
  return {
    ...state,
    phase: "error",
    message: text,
    pending: null,
    retry: kind === "network" ? state.pending : null,
    receipt: kind === "network" ? state.receipt : null,
    solution: state.solution,
    versionOverride,
    journal: [...state.journal, { at, id: state.pending.id, text }],
  };
}

export function beginReset(state: Session): Session {
  if (state.phase === "pending") return state;
  return { ...state, phase: "pending", message: null, pending: null, retry: null };
}

export function finishReset(state: Session, at: string, ok: boolean, failure: FailureKind = "unconfirmed"): Session {
  if (state.phase !== "pending") return state;
  const text = ok ? messages.resetDone : failureText(failure);
  return {
    ...state,
    phase: ok ? "done" : "error",
    message: text,
    pending: null,
    receipt: ok ? null : state.receipt,
    journal: [...state.journal, { at, id: null, text }],
  };
}

function reject(state: Session, text: string, at: string, id: string | null): Session {
  return {
    ...state,
    phase: "error",
    message: text,
    journal: [...state.journal, { at, id, text }],
  };
}

function sameDraft(retry: Intent, draft: Omit<Intent, "requestId">): boolean {
  return (
    retry.action === draft.action &&
    retry.id === draft.id &&
    retry.expectedVersion === draft.expectedVersion &&
    retry.solution === draft.solution &&
    retry.deadline === draft.deadline
  );
}

export function failureText(kind: FailureKind): string {
  if (kind === "bad") return messages.badRequest;
  if (kind === "token") return messages.token;
  if (kind === "missing") return messages.missing;
  if (kind === "conflict") return messages.conflict;
  if (kind === "network") return messages.network;
  return messages.unconfirmed;
}

export function sourceLabel(status: "ok" | "stale" | "unavailable"): string {
  if (status === "ok") return messages.sourceOk;
  if (status === "stale") return messages.sourceStale;
  return messages.sourceUnavailable;
}
