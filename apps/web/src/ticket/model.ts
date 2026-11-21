import type { Coordinator, RawIncidentFields } from "@mts/contracts";

export type RawFieldView = {
  key: string;
  type: "string" | "number" | "boolean" | "null" | "array" | "object";
  text: string;
};

export function formatRawFields(fields: RawIncidentFields): RawFieldView[] {
  return Object.entries(fields).map(([key, value]) => ({ key, ...describeRawValue(value) }));
}

export function describeRawValue(value: unknown): Pick<RawFieldView, "type" | "text"> {
  if (value === null) return { type: "null", text: "null" };
  if (Array.isArray(value)) return { type: "array", text: JSON.stringify(value) };
  if (typeof value === "string") return { type: "string", text: value.length === 0 ? "\"\"" : value };
  if (typeof value === "number") return { type: "number", text: String(value) };
  if (typeof value === "boolean") return { type: "boolean", text: String(value) };
  if (typeof value === "object") return { type: "object", text: JSON.stringify(value) };
  return { type: "string", text: String(value) };
}

export function personalCoordinatorLine(coordinator: Coordinator | null | undefined): string | null {
  if (!coordinator) return null;
  return `Персональный координатор: ${coordinator.name}`;
}

export function assignmentHint(input: {
  present: boolean;
  directoryEmpty: boolean;
  token: string;
  coordinatorId: string;
  currentId: string | null;
  pending: boolean;
}): string | null {
  if (!input.present) return "Заявка в архиве. Назначение недоступно.";
  if (input.directoryEmpty) return "Справочник координаторов пуст.";
  if (input.token.trim().length === 0) return "Введите токен оператора.";
  if (input.coordinatorId.length === 0) return "Выберите координатора из справочника.";
  if (input.currentId !== null && input.coordinatorId === input.currentId) return "Этот координатор уже назначен.";
  if (input.pending) return null;
  return null;
}

export function canAssign(input: Parameters<typeof assignmentHint>[0]): boolean {
  return assignmentHint(input) === null && !input.pending;
}

export function ticketLoadFailure(status: number): string {
  if (status === 404) return "Заявка не найдена.";
  return "Не удалось загрузить поля заявки.";
}

export function directoryLoadFailure(): string {
  return "Не удалось загрузить справочник координаторов.";
}

export function assignmentFailure(status: number, code?: string): string {
  if (status === 409 && code === "VERSION_CONFLICT") {
    return "Заявка изменилась. Перечитайте карточку и повторите действие.";
  }
  if (status === 409 && code === "TICKET_ARCHIVED") return "Заявка в архиве. Назначение недоступно.";
  if (status === 404 && code === "COORDINATOR_NOT_FOUND") return "Координатор отсутствует в справочнике.";
  if (status === 404) return "Заявка не найдена.";
  if (status === 403) return "Токен оператора не принят.";
  if (status === 400) return "Проверьте выбранного координатора и версию заявки.";
  return "Не удалось сохранить назначение.";
}

export function coordinatorOutsideDirectory(
  directory: readonly Coordinator[],
  current: Coordinator | null | undefined,
): boolean {
  if (!current) return false;
  return directory.every((item) => item.id !== current.id);
}
