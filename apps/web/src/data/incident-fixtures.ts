import {
  COORDINATOR_TEAM, CoordinatorListSchema,
  FullTicketDetailSchema, SnapshotSchema, STATE_LABELS, isActiveState, makeMockTimeline,
  type FullTicketDetail, type Incident, type Notice, type Priority, type RawIncidentFields, type Snapshot,
} from "@mts/contracts";
import { DashboardRequestError } from "./api";
import type { IncidentClient } from "./incidents";

const coordinators = CoordinatorListSchema.parse([
  { id: "irina", name: "Ирина Волкова" },
  { id: "maksim", name: "Максим Орлов" },
  { id: "anna", name: "Анна Кузнецова" },
]);
const topics = [
  ["Мобильная связь", "Авторизация", "Ошибки входа в личный кабинет", "Эксплуатация сети"],
  ["Домашний интернет", "Витрина", "Задержка загрузки каталога тарифов", "Сопровождение витрины"],
  ["Каталог услуг", "Обработка заказов", "Не обновляется статус подключения", "Поддержка заказов"],
  ["Платежи", "Уведомления", "Не доставляются чеки об оплате", "Платёжная платформа"],
  ["Мобильная связь", "Активация SIM", "Повторная проверка заявки на активацию", "Эксплуатация сети"],
  ["Фиксированная связь", "Канал", "Потери пакетов при проверке канала", "Сетевой анализ"],
] as const;

type DemoStep = keyof ReturnType<typeof makeMockTimeline>["frames"];

export function createIncidentFixtures(nowMs: number) {
  const timeline = makeMockTimeline(nowMs);
  const incidents = [...timeline.initial.incidents];
  const example = timeline.initial.incidents[1];
  const states = [
    ...Array<keyof typeof STATE_LABELS>(13).fill("Assigned"),
    ...Array<keyof typeof STATE_LABELS>(9).fill("WorkInProgress"),
    ...Array<keyof typeof STATE_LABELS>(10).fill("Resolved"),
    ...Array<keyof typeof STATE_LABELS>(5).fill("Closed"),
    ...Array<keyof typeof STATE_LABELS>(4).fill("Research"),
  ];
  const now = () => new Date(nowMs).toISOString();
  const at = (minutes: number) => new Date(nowMs + minutes * 60_000).toISOString();
  for (const [index, state] of states.entries()) {
    const [product, service, title, team] = topics[index % topics.length];
    const coordinator = index % 7 === 0 ? coordinators[index % coordinators.length] : null;
    const priority: Priority = index < 3 ? 3 : index % 5 < 2 || index === 38 ? 1 : 2;
    incidents.push({
      ...example,
      id: `INC${String(index + 4).padStart(12, "0")}`,
      version: `fixture-${index + 4}`,
      title, product, service, team: coordinator ? COORDINATOR_TEAM : team, coordinator,
      assignee: coordinator?.name ?? (index % 3 === 0 ? "Алексей Смирнов" : null),
      state, stateLabel: STATE_LABELS[state], priority,
      createdAt: at(-120 - index * 70),
      dueAt: [5, 20, 37, 39].includes(index) ? null : at([-70, 18, 190, 52, -15, 29][index % 6]),
      resolvedAt: state === "Assigned" || state === "WorkInProgress" ? null : at(-50 - index),
      summary: "Запись синтетической выгрузки для проверки работы пульта.",
    });
  }
  const initial = SnapshotSchema.parse({
    ...timeline.initial, incidents, groups: fixtureGroups(incidents),
  });
  let current = initial;
  let seq = 0;
  const details = new Map<string, FullTicketDetail>();

  function makeDetail(incident: Incident, prior?: FullTicketDetail): FullTicketDetail {
    const { id, version, title, product, service, team, assignee, coordinator, state, stateLabel, priority,
      createdAt, dueAt, resolvedAt, urgency, impact, summary } = incident;
    const description = prior?.description ?? summary;
    const solution = prior?.solution ?? "Проверены журналы и восстановлена штатная обработка запросов.";
    const ticket = {
      id, version, title, product, service, team, assignee, coordinator, state, stateLabel, priority,
      createdAt, dueAt, resolvedAt, present: true, hasSolution: solution !== null,
    };
    const entry: FullTicketDetail["history"][number] = {
      version, at: current.serverNow, present: true, stateLabel, team, coordinator, dueAt, priority, description, solution,
    };
    const ordinal = Number(id.slice(3));
    const rawFields: RawIncidentFields = {
      id, sysId: `9007199254740993${id.slice(-3)}`, header: title, productName: product, service,
      shortDescription: summary, description, solution, submitDate: createdAt, deadline: dueAt ?? "",
      completionDate: resolvedAt, assignedGroupName: team, assignedEmployee: assignee,
      stateEnum: state, state: stateLabel, priorityId: priority, urgencyId: urgency, impactId: impact,
      isDuplicate: ordinal % 9 === 0, eliminationOfConsequences: ordinal % 11 === 0,
      waitingExitDate: null, retryCount: 0, externalReference: "0007",
    };
    return FullTicketDetailSchema.parse({ ticket, description, solution, history: [entry, ...(prior?.history ?? [])], rawFields });
  }

  for (const incident of initial.incidents) details.set(incident.id, makeDetail(incident));

  function publish(incident: Incident, notice: Omit<Notice, "seq" | "at"> | null, serverNow = now()) {
    const nextIncidents = current.incidents.map((item) => item.id === incident.id ? incident : item);
    if (!nextIncidents.some(({ id }) => id === incident.id)) nextIncidents.push(incident);
    current = SnapshotSchema.parse({
      ...current, serverNow, revision: current.revision + 1,
      incidents: nextIncidents, groups: fixtureGroups(nextIncidents),
      notices: notice ? [...current.notices, { ...notice, seq: ++seq, at: serverNow, revision: current.revision + 1 }].slice(-50) : current.notices,
    });
    details.set(incident.id, makeDetail(incident, details.get(incident.id)));
    return current;
  }

  function detail(id: string) {
    const entry = details.get(id);
    if (!entry) throw new DashboardRequestError("NOT_FOUND", "Инцидент не найден", 404);
    return entry;
  }

  const client: IncidentClient = {
    async detail(id) { return detail(id); },
    async coordinators() { return coordinators; },
  };

  function step(step: DemoStep, actualNow: number) {
    const [critical, timer] = current.incidents;
    const template = timeline.frames[step].incidents[0];
    if ((step === "critical" && critical.priority === 4 && isActiveState(critical.state)) ||
        (step === "assign" && critical.team === COORDINATOR_TEAM && critical.coordinator?.id === coordinators[0].id) ||
        (step === "resolve" && critical.state === "Resolved")) return current;
    const target = step === "deadline" ? timer : critical;
    const serverNow = new Date(actualNow).toISOString();
    const version = `fixture-${target.id}-${current.revision + 1}`;
    if (step === "deadline") {
      return publish({ ...target, version, dueAt: new Date(actualNow + 90_000).toISOString() }, null, serverNow);
    }
    const change = step === "critical"
      ? { priority: template.priority, state: template.state, stateLabel: template.stateLabel, resolvedAt: null }
      : step === "assign"
        ? { team: COORDINATOR_TEAM, assignee: coordinators[0].name, coordinator: coordinators[0] }
        : { state: template.state, stateLabel: template.stateLabel, resolvedAt: serverNow };
    const kind = step === "critical" ? "critical.new" : step === "assign" ? "coordinator.assigned" : "critical.resolved";
    return publish({ ...target, ...change, version }, { kind, incidentId: target.id, title: target.title }, serverNow);
  }

  function reset(actualNow: number) {
    const serverNow = new Date(actualNow).toISOString();
    current = {
      ...initial, revision: current.revision + 1, serverNow,
      incidents: initial.incidents.map((incident) => ({
        ...incident, version: `fixture-${incident.id}-${current.revision + 1}`,
      })),
      notices: [{ seq: ++seq, revision: current.revision + 1, kind: "demo.reset", incidentId: null, title: "Набор восстановлен", at: serverNow }],
    };
    for (const incident of current.incidents) details.set(incident.id, makeDetail(incident, details.get(incident.id)));
    return current;
  }

  return { initial, client, step, reset };
}

function fixtureGroups(incidents: Incident[]): Snapshot["groups"] {
  const active = incidents.filter(({ state }) => isActiveState(state));
  const research = incidents.filter(({ state }) => state === "Research");
  return {
    critical: active.filter(({ priority }) => priority === 4).map(({ id }) => id),
    high: active.filter(({ priority }) => priority === 3).map(({ id }) => id),
    coordinator: [...active, ...research].filter(({ team }) => team === COORDINATOR_TEAM).map(({ id }) => id),
    research: research.map(({ id }) => id),
  };
}
