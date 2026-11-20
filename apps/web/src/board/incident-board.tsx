import { getSlaState, type Incident, type Snapshot } from "@mts/contracts";

const GROUPS = [
  ["critical", "Критические"],
  ["coordinator", "У координаторов"],
  ["high", "Высокий приоритет"],
  ["research", "Исследование"],
] as const;

export function IncidentBoard({
  snapshot,
  nowMs,
  onInspect,
}: {
  snapshot: Snapshot;
  nowMs: number;
  onInspect: (id: string) => void;
}) {
  const incidents = new Map(snapshot.incidents.map((incident) => [incident.id, incident]));

  return (
    <div className="board">
      {GROUPS.map(([key, title]) => {
        const ids = snapshot.groups[key];
        return (
          <section className="group" key={key} aria-label={title}>
            <h2>
              {title} · {ids.length}
            </h2>
            {ids.length === 0 ? <p className="empty">Нет инцидентов</p> : null}
            <div className="cards">
              {ids.map((id) => {
                const incident = incidents.get(id);
                if (!incident) return null;
                return (
                  <article className={cardClass(incident, nowMs)} key={id}>
                    <h3>
                      <button type="button" onClick={() => onInspect(incident.id)}>
                        {incident.title}
                      </button>
                    </h3>
                    <p>{incident.id}</p>
                    <p>
                      {incident.product ?? "Продукт не указан"}
                      {incident.service ? ` · ${incident.service}` : ""}
                    </p>
                    <p className="time" title={moscow(incident.createdAt)}>
                      {moscow(incident.createdAt)}
                    </p>
                    <p>{incident.assignee ?? (incident.team ? "Исполнитель не назначен" : "Назначение не указано")}</p>
                    <p>{incident.team ?? "Группа не назначена"}</p>
                    <p>{incident.stateLabel}</p>
                    <p className="time" title={incident.dueAt ? moscow(incident.dueAt) : undefined}>
                      {slaText(incident, nowMs)}
                    </p>
                    {incident.itsmUrl ? (
                      <a href={incident.itsmUrl} target="_blank" rel="noopener noreferrer">
                        В ITSM
                      </a>
                    ) : null}
                  </article>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function cardClass(incident: Incident, nowMs: number): string {
  const sla = getSlaState(incident, nowMs);
  if (incident.priority === 4 || sla === "overdue") return "card critical";
  if (sla === "near") return "card near";
  return "card";
}

function slaText(incident: Incident, nowMs: number): string {
  const sla = getSlaState(incident, nowMs);
  if (sla === "done" && incident.state === "Research") return "Решён · исследование";
  if (sla === "done" && incident.state === "Closed") return "Закрыт";
  if (sla === "done") return "Решён";
  if (sla === "near") return "Срок близко";
  if (sla === "overdue") return "Просрочен";
  if (sla === "unknown") return "Срок не задан";
  return incident.dueAt ? moscow(incident.dueAt) : "Срок не задан";
}

function moscow(iso: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}
