import type { AnalysisResult, FullTicketDetail, Incident, RawIncidentFields } from "@mts/contracts";
import * as Dialog from "@radix-ui/react-dialog";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, X } from "lucide-react";
import type { ReactNode } from "react";
import { AnalysisPanel } from "../analysis";
import { coordinatorQuery, detailQuery, type IncidentClient } from "../data/incidents";
import { CoordinatorForm } from "./coordinator-form";
import { formatMoscow, presentSla } from "./format";
import { itsmHref } from "./itsm";
import { incidentCoordinator, PRIORITIES } from "./model";
import styles from "./detail.module.css";

const sections = [
  ["Заявка", {
    id: "Номер заявки", sysId: "Системный ID", header: "Заголовок", scenarioName: "Сценарий",
    productName: "Продукт", productUrl: "Адрес продукта", service: "Сервис",
  }],
  ["Состояние и сроки", {
    stateEnum: "Рабочий статус", state: "Подпись статуса", stateId: "Исходный код статуса",
    priorityId: "Код приоритета", priority: "Подпись приоритета", urgencyId: "Код срочности", impactId: "Код влияния",
    submitDate: "Исходная дата регистрации", deadline: "Исходный срок", completionDate: "Исходная дата завершения",
    waitingExitDate: "Служебная дата выхода из ожидания",
  }],
  ["Назначение в выгрузке", {
    assignedGroupName: "Группа", assignedEmployee: "Исполнитель",
    lastAssignmentToTeamDateTime: "Последнее назначение группе",
  }],
  ["Исходные тексты и признаки", {
    description: "Описание", shortDescription: "Краткое описание", solution: "Решение",
    isDuplicate: "Дубль", duplicate: "Дубль", duplicateId: "Номер дубля", duplicateOf: "Дубль заявки",
    duplicateIncidentId: "Связанный дубль", consequenceElimination: "Устранение последствий",
    eliminationOfConsequences: "Устранение последствий", isConsequenceElimination: "Устранение последствий",
    isEliminationOfConsequences: "Устранение последствий",
  }],
] as const;

const knownKeys = new Set(sections.flatMap(([, labels]) => Object.keys(labels)));

export function IncidentDetails({ id, incident, mode, nowMs, client, sseRevision, operatorToken, runAnalysis, onClose, onReturnFocus }: {
  id: string;
  incident: Incident | undefined;
  mode: "detail" | "assignment";
  nowMs: number;
  client: IncidentClient;
  sseRevision: number | null;
  operatorToken?: string;
  runAnalysis: (id: string, token?: string) => Promise<AnalysisResult>;
  onClose: () => void;
  onReturnFocus: () => void;
}) {
  const detail = useQuery({ ...detailQuery(client, id, incident?.version), refetchOnMount: "always" });
  const directory = useQuery(coordinatorQuery(client));
  const record = detail.data;
  const known = record?.ticket ?? incident;
  const current = known ? incidentCoordinator(known) : null;
  const sla = incident ? presentSla(incident, nowMs) : null;
  const title = mode === "assignment" ? (current ? "Сменить координатора" : "Назначить координатора")
    : known?.title ?? "Инцидент";

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className={`detail ${styles.panel}`} data-surface="surface"
          onCloseAutoFocus={(event) => { event.preventDefault(); onReturnFocus(); }}>
          <div className="detail-heading">
            <div>
              <Dialog.Description className="detail-id" data-numeric="tabular">{id}</Dialog.Description>
              <Dialog.Title>{title}</Dialog.Title>
              {mode === "assignment" && known ? <p className={styles.subtitle}>{known.title}</p> : null}
            </div>
            <Dialog.Close className="detail-close" aria-label="Закрыть"><X size={21} aria-hidden /></Dialog.Close>
          </div>
          {mode === "detail" && sla ? (
            <p className="detail-sla" data-tone={sla.tone} data-numeric="tabular" title={sla.hint}>
              <span>SLA</span><strong>{sla.status}</strong>{sla.duration ? <span>{sla.duration}</span> : null}
            </p>
          ) : null}
          {mode === "detail" && known ? (
            <FieldList entries={[
              ["Приоритет", priorityLabel(known.priority)], ["Статус", known.stateLabel],
              ["Продукт", known.product], ["Сервис", known.service], ["Регистрация", formatMoscow(known.createdAt)],
              ["Срок SLA", known.dueAt && formatMoscow(known.dueAt)], ["Завершение", known.resolvedAt && formatMoscow(known.resolvedAt)],
              ["Команда", known.team], ["Исполнитель", known.assignee], ["Координатор", current?.name ?? null],
            ]} />
          ) : null}
          {detail.isPending ? <p role="status">Загружаем полную запись…</p> : null}
          {detail.isError ? (
            <div className={styles.failure}>
              <p role="alert">{detail.error.message}</p>
              <button type="button" className={styles.button} onClick={() => void detail.refetch()}>Повторить загрузку</button>
            </div>
          ) : null}
          {directory.isError && record?.ticket.present ? (
            <div className={styles.failure}>
              <p role="alert">Не удалось загрузить справочник координаторов.</p>
              <button type="button" className={styles.button} onClick={() => void directory.refetch()}>Загрузить справочник</button>
            </div>
          ) : null}
          <CoordinatorForm id={id} detail={record} coordinators={directory.data} client={client}
            operatorToken={operatorToken} sseRevision={sseRevision} busy={detail.isFetching}
            reload={async () => (await detail.refetch()).isSuccess} />
          {mode === "detail" ? (
            <>
              <a className="detail-itsm" href={itsmHref(incident ?? { id, itsmUrl: null })} target="_blank" rel="noopener noreferrer">
                В ITSM <ArrowUpRight size={16} aria-hidden />
              </a>
              {record ? <FullRecord detail={record} /> : null}
              {incident ? <AnalysisPanel incident={incident} runAnalysis={runAnalysis} operatorToken={operatorToken} /> : null}
            </>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function FullRecord({ detail }: { detail: FullTicketDetail }) {
  const fields = detail.rawFields;
  const unknown = Object.entries(fields).filter(([key]) => !knownKeys.has(key));
  return (
    <>
      <section className={styles.texts} aria-label="Описание и решение">
        <h3>Описание</h3>
        <p>{detail.description ?? "Описание не указано"}</p>
        <h3>Решение</h3>
        <p>{detail.solution ?? "Решение не указано"}</p>
      </section>
      {sections.map(([name, labels]) => {
        const entries = Object.entries(labels).filter(([key]) => Object.hasOwn(fields, key));
        if (!entries.length) return null;
        return (
          <details className={styles.section} key={name}>
            <summary>{name}</summary>
            <FieldList entries={entries.map(([key, label]) => [label, rawValue(fields[key])])} />
          </details>
        );
      })}
      {unknown.length > 0 ? (
        <details className={styles.section}>
          <summary>Неизвестные поля</summary>
          <FieldList entries={unknown.map(([key, value]) => [key, rawValue(value)])} />
        </details>
      ) : null}
      <details className={styles.section}>
        <summary>История · {detail.history.length}</summary>
        {detail.history.length === 0 ? <p>История пуста</p> : (
          <ol className={styles.history}>
            {detail.history.map((entry) => (
              <li key={entry.version}>
                <details>
                  <summary>{formatMoscow(entry.at)} · {entry.stateLabel}</summary>
                  <FieldList entries={[
                    ["Версия", <code>{entry.version}</code>], ["В выгрузке", entry.present ? "Да" : "Нет"],
                    ["Команда", entry.team], ["Координатор", entry.coordinator?.name ?? null],
                    ["Приоритет", priorityLabel(entry.priority)], ["Срок", entry.dueAt && formatMoscow(entry.dueAt)],
                    ["Описание", entry.description], ["Решение", entry.solution],
                  ]} />
                </details>
              </li>
            ))}
          </ol>
        )}
      </details>
    </>
  );
}

function FieldList({ entries }: { entries: readonly (readonly [string, ReactNode])[] }) {
  return (
    <dl className="detail-fields">
      {entries.map(([label, value], index) => <div key={`${label}:${index}`}><dt>{label}</dt><dd>{value ?? "—"}</dd></div>)}
    </dl>
  );
}

function priorityLabel(priority: Incident["priority"]) {
  return PRIORITIES.find(({ id }) => id === priority)?.label ?? String(priority);
}

function rawValue(value: RawIncidentFields[string]) {
  return <code className={styles.raw}>{JSON.stringify(value)}</code>;
}
