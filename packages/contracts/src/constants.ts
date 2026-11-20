export const API_PREFIX = "/api/v1";
export const LOCAL_API_PORT = 8787;
export const COORDINATOR_TEAM = "КЦ ИТ Координаторы Массовых Инцидентов";

export const STATE_LABELS = {
  Assigned: "Назначен",
  WorkInProgress: "Выполняется",
  Resolved: "Завершен",
  Closed: "Закрыт",
  Research: "Исследование ситуации",
} as const;

export const PRIORITY_LABELS = {
  1: "Низкий",
  2: "Средний",
  3: "Высокий",
  4: "Наивысший",
} as const;
