import { StateSchema, STATE_LABELS, type Coordinator, type Incident, type Priority } from "@mts/contracts";
import { useState } from "react";
import { PRIORITIES, incidentCoordinator } from "../board/model";
import { Icon } from "../icons";
import { DEFAULT_FILTERS, type QueueFilters } from "./queue-summary";
import styles from "./dashboard.module.css";

type Option = { value: string; label: string };
const any = { value: "", label: "Любой" };
const flags = [any, { value: "yes", label: "Да" }, { value: "no", label: "Нет" }];
const byName = new Intl.Collator("ru");
const statusOptions = [
  { value: "default", label: "Текущие очереди" },
  { value: "active", label: "Активные заявки" },
  { value: "all", label: "Все статусы" },
  ...StateSchema.options.map((value) => ({
    value, label: value === "Other" ? "Другой" : STATE_LABELS[value],
  })),
];

export function toggleOption<T>(items: readonly T[], item: T): T[] {
  return items.includes(item) ? items.filter((value) => value !== item) : [...items, item];
}

export function IncidentFilters({ filters, incidents, coordinators, onChange }: {
  filters: QueueFilters;
  incidents: readonly Incident[];
  coordinators: readonly Coordinator[];
  onChange: (patch: Partial<QueueFilters>) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const active = (Object.keys(DEFAULT_FILTERS) as (keyof QueueFilters)[]).some((key) =>
    Array.isArray(filters[key]) ? filters[key].length > 0 : filters[key] !== DEFAULT_FILTERS[key],
  );
  const coordinatorOptions = new Map(coordinators.map(({ id, name }) => [id, name]));
  for (const incident of incidents) {
    const coordinator = incidentCoordinator(incident);
    if (coordinator && !coordinatorOptions.has(coordinator.id)) coordinatorOptions.set(coordinator.id, coordinator.name);
  }
  const extraCount = [
    filters.priority, filters.coordinator, filters.team, filters.product, filters.service,
    filters.dateFrom, filters.dateTo, filters.duplicates, filters.consequences,
  ].filter(Boolean).length + filters.sla.length + filters.coordinatorPresence.length;
  return (
    <div className={styles.filters} role="group" aria-label="Фильтры инцидентов">
      <div className={styles.filterMain}>
        <label className={styles.search}>
          <span className="sr-only">Поиск инцидентов</span>
          <Icon name="search" size={17} />
          <input id="incident-search" type="search" value={filters.search} placeholder="ID, заголовок, продукт или сервис"
            onChange={(event) => onChange({ search: event.target.value })} />
        </label>
        <Select label="Статус" hiddenLabel value={filters.status} options={statusOptions}
          onChange={(value) => onChange({ status: value as QueueFilters["status"] })} />
        <button type="button" className={styles.control} aria-expanded={expanded} aria-controls="incident-extra-filters"
          onClick={() => setExpanded(!expanded)}>
          <Icon name="filter" size={17} /> Фильтры{extraCount ? ` (${extraCount})` : ""}
        </button>
        {active ? (
          <button type="button" className={styles.resetFilter} onClick={() => {
            document.getElementById("incident-search")?.focus({ preventScroll: true });
            onChange(DEFAULT_FILTERS);
          }}>
            <Icon name="x-lg" /> Сбросить
          </button>
        ) : null}
      </div>
      <div id="incident-extra-filters" hidden={!expanded}>
        <div className={styles.quick} role="group" aria-label="Быстрые фильтры">
          {([
            ["near", "Срок близко"], ["overdue", "Просрочены"], ["noDeadline", "Без срока"],
          ] as const).map(([key, label]) => (
            <button key={key} type="button" className={styles.control} aria-pressed={filters.sla.includes(key)}
              onClick={() => onChange({ sla: toggleOption(filters.sla, key) })}>{label}</button>
          ))}
          <button type="button" className={styles.control} aria-pressed={filters.coordinatorPresence.includes("assigned")}
            onClick={() => onChange({ coordinatorPresence: toggleOption(filters.coordinatorPresence, "assigned") })}>
            У координатора
          </button>
          <button type="button" className={styles.control} aria-pressed={filters.coordinatorPresence.includes("unassigned")}
            onClick={() => onChange({ coordinatorPresence: toggleOption(filters.coordinatorPresence, "unassigned") })}>
            Без координатора
          </button>
        </div>
        <div className={styles.extra}>
          <Select label="Приоритет" value={filters.priority} options={[
            any, ...PRIORITIES.map(({ id, label }) => ({ value: String(id), label })),
          ]} onChange={(value) => onChange({ priority: value ? Number(value) as Priority : "" })} />
          <Select label="Координатор" value={filters.coordinator} options={[
            any, ...[...coordinatorOptions].sort((a, b) => byName.compare(a[1], b[1]))
              .map(([value, label]) => ({ value, label })),
          ]} onChange={(value) => onChange({ coordinator: value })} />
          <Select label="Команда" value={filters.team} options={options(incidents.map(({ team }) => team))}
            onChange={(value) => onChange({ team: value })} />
          <Select label="Продукт" value={filters.product} options={options(incidents.map(({ product }) => product))}
            onChange={(value) => onChange({ product: value })} />
          <Select label="Сервис" value={filters.service} options={options(incidents.map(({ service }) => service))}
            onChange={(value) => onChange({ service: value })} />
          <label className={styles.field}>Дата регистрации с
            <input type="date" value={filters.dateFrom} max={filters.dateTo || undefined}
              onChange={(event) => onChange({ dateFrom: event.target.value })} />
          </label>
          <label className={styles.field}>Дата регистрации по
            <input type="date" value={filters.dateTo} min={filters.dateFrom || undefined}
              onChange={(event) => onChange({ dateTo: event.target.value })} />
          </label>
          <Select label="Дубли" value={filters.duplicates} options={flags}
            onChange={(value) => onChange({ duplicates: value as QueueFilters["duplicates"] })} />
          <Select label="Устранение последствий" value={filters.consequences} options={flags}
            onChange={(value) => onChange({ consequences: value as QueueFilters["consequences"] })} />
        </div>
      </div>
    </div>
  );
}

function options(values: (string | null)[]): Option[] {
  return [any, ...[...new Set(values.filter((value): value is string => Boolean(value)))]
    .sort(byName.compare).map((value) => ({ value, label: value }))];
}

function Select({ label, value, options, onChange, hiddenLabel }: {
  label: string;
  value: string | number;
  options: Option[];
  onChange: (value: string) => void;
  hiddenLabel?: boolean;
}) {
  return (
    <label className={styles.field}>
      <span className={hiddenLabel ? "sr-only" : undefined}>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
      </select>
    </label>
  );
}
