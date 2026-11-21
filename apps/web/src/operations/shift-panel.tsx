import type { Incident } from "@mts/contracts";
import * as Dialog from "@radix-ui/react-dialog";
import { useRef, useState } from "react";
import { formatMoscow } from "../board/format";
import { Icon } from "../icons";
import dashboardStyles from "./dashboard.module.css";
import { CLUSTER_WINDOW_MINUTES, type IncidentCluster } from "./shift-triage";
import styles from "./shift-panel.module.css";

export function ShiftPanel({ clusters, makeHandoff, onInspect }: {
  clusters: readonly IncidentCluster[];
  makeHandoff: (() => string) | null;
  onInspect: (incident: Incident, source: HTMLButtonElement) => void;
}) {
  const [report, setReport] = useState<string | null>(null);

  return (
    <section className={styles.panel} aria-labelledby="shift-heading" data-surface="surface">
      <header className={styles.header}>
        <h2 id="shift-heading">Разбор смены</h2>
        <Dialog.Root open={report !== null} onOpenChange={(open) => setReport(open && makeHandoff ? makeHandoff() : null)}>
          <Dialog.Trigger className={dashboardStyles.control} disabled={!makeHandoff}>
            <Icon name="clipboard-data" size={17} /> Передать смену
          </Dialog.Trigger>
          {report !== null ? <HandoffPreview report={report} /> : null}
        </Dialog.Root>
      </header>
      <details className={styles.groups}>
        <summary>
          <span>Возможные общие сбои</span>
          <strong data-numeric="tabular">{clusters.length}</strong>
        </summary>
        <p className={styles.context}>
          Совпадения по заголовку, продукту и сервису за {CLUSTER_WINDOW_MINUTES} мин. Общую причину нужно проверить.
        </p>
        {clusters.length === 0 ? <p className={styles.empty}>Групп совпадений пока нет.</p> : (
          <ul className={styles.clusterList} aria-label="Группы совпадений">
            {clusters.map(({ id, incidents }) => {
              const [first] = incidents;
              const last = incidents[incidents.length - 1];
              const scope = [first.product, first.service].filter(Boolean).join(" · ");
              return (
                <li key={id} className={styles.cluster}>
                  <h3>{first.title}</h3>
                  <p>{scope}</p>
                  <p className={styles.context}>Регистрация · {formatMoscow(first.createdAt)} — {formatMoscow(last.createdAt)} МСК</p>
                  <ul className={styles.members} aria-label="Заявки группы">
                    {incidents.map((incident) => (
                      <li key={incident.id}>
                        <button type="button" className={dashboardStyles.control}
                          onClick={(event) => onInspect(incident, event.currentTarget)}>{incident.id}</button>
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ul>
        )}
      </details>
    </section>
  );
}

function HandoffPreview({ report }: { report: string }) {
  const text = useRef<HTMLTextAreaElement>(null);
  const [message, setMessage] = useState("");

  async function copy() {
    try {
      if (!navigator.clipboard) throw new Error("Буфер недоступен");
      await navigator.clipboard.writeText(report);
      setMessage("Сводка скопирована.");
    } catch {
      text.current?.focus();
      text.current?.select();
      setMessage("Буфер недоступен. Текст выделен для ручного копирования.");
    }
  }

  return (
    <Dialog.Portal>
      <Dialog.Overlay className="overlay" />
      <Dialog.Content className={`detail ${styles.handoff}`} data-surface="surface">
        <div className="detail-heading">
          <div>
            <Dialog.Title>Передача смены</Dialog.Title>
            <Dialog.Description className={styles.context}>
              Сводка зафиксирована при открытии. Откройте её заново, чтобы обновить.
            </Dialog.Description>
          </div>
          <Dialog.Close className="detail-close" aria-label="Закрыть сводку"><Icon name="x-lg" size={21} /></Dialog.Close>
        </div>
        <textarea ref={text} className={styles.preview} aria-label="Текст сводки" value={report} readOnly rows={16} />
        <button type="button" className={dashboardStyles.control} onClick={() => void copy()}>
          <Icon name="clipboard-data" size={17} /> Копировать сводку
        </button>
        <p className={styles.copyStatus} role="status">{message}</p>
      </Dialog.Content>
    </Dialog.Portal>
  );
}
