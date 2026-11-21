import { RawIncidentSchema } from "@mts/contracts";

export type ImportIssue = {
  row: number | null;
  id: string | null;
  path: string;
  reason: string;
};

type FieldIssue = NonNullable<ReturnType<typeof RawIncidentSchema.safeParse>["error"]>["issues"][number];

const reasonByField: Record<string, string> = {
  id: "Укажите непустой строковый ID.",
  sysId: "Ожидается строковый системный ID или null.",
  priorityId: "Укажите числовой приоритет от 1 до 4.",
  submitDate: "Укажите дату регистрации в поддерживаемом формате UTC.",
  deadline: "Укажите дату срока в поддерживаемом формате UTC или оставьте поле пустым.",
  completionDate: "Укажите дату завершения в поддерживаемом формате UTC или оставьте поле пустым.",
  stateId: "Ожидается число, строка или null.",
};

export function describeImportIssues(jsonText: string, serverErrors: readonly string[]): ImportIssue[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return serverErrors.map((reason) => ({ row: null, id: null, path: "$", reason }));
  }
  const rows: unknown[] = Array.isArray(parsed) ? parsed : [];
  const ids = rows.map(readId);
  const seen = new Set<string>();
  const issues: ImportIssue[] = [];
  for (const [index, value] of rows.entries()) {
    const id = ids[index];
    const row = index + 1;
    const result = RawIncidentSchema.safeParse(value);
    if (!result.success) {
      for (const issue of result.error.issues) {
        issues.push({ row, id, path: fieldPath(index, issue.path), reason: describeField(issue) });
      }
    }
    if (id !== null && typeof readIdValue(value) === "string") {
      if (seen.has(id)) issues.push({ row, id, path: fieldPath(index, ["id"]), reason: "ID уже встречался в файле." });
      seen.add(id);
    }
  }

  const locations = new Set(issues.map(({ path }) => path));
  for (const reason of serverErrors) {
    if (/^Всего ошибок: \d+\.$/.test(reason) && issues.length >= Number(reason.match(/\d+/)?.[0])) continue;
    const match = /^Запись (\d+)(?:, поле ([^:]+))?: (.+)$/.exec(reason);
    if (!match) {
      issues.push({ row: null, id: null, path: "$", reason });
      continue;
    }
    const row = Number(match[1]);
    const path = fieldPath(row - 1, match[2] ? [match[2]] : []);
    if (!locations.has(path)) issues.push({ row, id: ids[row - 1] ?? null, path, reason: match[3] });
  }
  return issues.sort((left, right) => (left.row ?? 0) - (right.row ?? 0));
}

function readIdValue(value: unknown): unknown {
  if (value === null || typeof value !== "object" || !Object.hasOwn(value, "id")) return undefined;
  return (value as { id: unknown }).id;
}

function readId(value: unknown): string | null {
  const id = readIdValue(value);
  if (typeof id === "string") return id.trim() || null;
  return typeof id === "number" ? String(id) : null;
}

function fieldPath(index: number, fields: readonly PropertyKey[]): string {
  return `$[${index}]` + fields.map((part) => {
    if (typeof part === "number") return `[${part}]`;
    const name = String(part);
    return /^[\w$]+$/.test(name) ? `.${name}` : `[${JSON.stringify(name)}]`;
  }).join("");
}

function describeField(issue: FieldIssue): string {
  if (issue.path.length === 0) return "Ожидается объект заявки.";
  const field = String(issue.path[0]);
  if (Object.hasOwn(reasonByField, field)) return reasonByField[field];
  if (issue.code === "invalid_type" && issue.expected === "string") return "Ожидается строка.";
  if (issue.code === "invalid_union") return "Ожидается строка или null.";
  return "Некорректное значение.";
}
