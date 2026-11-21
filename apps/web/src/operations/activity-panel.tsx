import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon, type IconName } from "../icons";
import { eventIdentity, filterActivity, PIN_STORAGE_PREFIX, readPinnedEvents, storePin, type ActivityFilter } from "./activity-pins";
import { ACTIVITY_LABELS, type ActivityEvent } from "./activity";
import styles from "./dashboard.module.css";

const eventTypes = {
  "incident.new": { icon: "plus-circle", tone: "info" },
  "critical.new": { icon: "shield-exclamation", tone: "critical" },
  "coordinator.assigned": { icon: "people", tone: "info" },
  "coordinator.changed": { icon: "people", tone: "info" },
  "critical.resolved": { icon: "check-circle", tone: "success" },
  "sla.near": { icon: "alarm", tone: "warning" },
  "sla.overdue": { icon: "clock-history", tone: "warning" },
  "demo.reset": { icon: "arrow-counterclockwise", tone: "neutral" },
} satisfies Record<ActivityEvent["kind"], { icon: IconName; tone: string }>;

const clock = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
});

export function ActivityPanel({ events, unreadCount, markRead, onInspect, children }: {
  events: readonly ActivityEvent[];
  unreadCount: number;
  markRead: () => void;
  onInspect: (id: string, eventKey: string) => void;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<ActivityFilter>("");
  const [pins, setPins] = useState(readPinnedEvents);
  const filterSelect = useRef<HTMLSelectElement>(null);
  const visible = useMemo(() => filterActivity(events, pins, filter), [events, pins, filter]);

  useEffect(() => {
    function syncPins(event: StorageEvent) {
      if (event.key === null || event.key.startsWith(PIN_STORAGE_PREFIX)) setPins(readPinnedEvents());
    }
    window.addEventListener("storage", syncPins);
    return () => window.removeEventListener("storage", syncPins);
  }, []);

  useEffect(() => {
    if (open && unreadCount > 0) markRead();
  }, [markRead, open, unreadCount]);

  function togglePin(event: ActivityEvent, key: string, isPinned: boolean) {
    storePin(event, !isPinned);
    setPins((previous) => {
      const next = new Map(previous);
      if (isPinned) next.delete(key);
      else next.set(key, event);
      return next;
    });
    if (isPinned && (filter === "pinned" || !events.some((item) => eventIdentity(item) === key))) {
      filterSelect.current?.focus();
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      {children}
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="detail" data-surface="surface" onPointerDownOutside={(event) => {
          if (event.target instanceof Element && event.target.closest("[data-incident-details]")) event.preventDefault();
        }}>
          <div className="detail-heading">
            <div>
              <Dialog.Title>События</Dialog.Title>
              <Dialog.Description className={styles.eventDescription}>Время событий указано по Москве</Dialog.Description>
            </div>
            <Dialog.Close className="detail-close" aria-label="Закрыть события"><Icon name="x-lg" size={21} /></Dialog.Close>
          </div>
          <label className={`${styles.field} ${styles.eventFilter}`}>
            Тип события
            <select ref={filterSelect} value={filter} onChange={(event) => setFilter(event.target.value as ActivityFilter)}>
              <option value="">Все типы</option>
              <option value="pinned">Закрепленные</option>
              {Object.entries(ACTIVITY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          {visible.length === 0 ? (
            <p className={styles.empty}>{emptyActivityMessage(filter)}</p>
          ) : (
            <ol className={styles.events}>
              {visible.map((event) => {
                const key = eventIdentity(event);
                const pinned = pins.has(key);
                const pinAction = pinned ? "Открепить событие" : "Закрепить событие";
                const { icon, tone } = eventTypes[event.kind];
                const label = ACTIVITY_LABELS[event.kind];
                const id = event.incidentId;
                return (
                  <li key={key} className={styles.event}>
                    <span className={styles.symbol} data-tone={tone}><Icon name={icon} size={17} /></span>
                    <div className={styles.eventInfo}>
                      <div className={styles.eventTop}>
                        <strong>{label}</strong>
                        <time dateTime={event.at}>{clock.format(new Date(event.at))}</time>
                      </div>
                      {id ? (
                        <button type="button" className={styles.eventLink} onClick={() => onInspect(id, event.key)}>
                          {event.title && event.title !== label ? event.title : id}
                          <Icon name="box-arrow-up-right" size={14} />
                        </button>
                      ) : event.title && event.title !== label ? <p>{event.title}</p> : null}
                      {id && event.title && event.title !== label ? <small data-numeric="tabular">{id}</small> : null}
                    </div>
                    <button type="button" className={styles.eventPin} data-pinned={pinned || undefined}
                      title={pinAction} aria-label={`${pinAction} «${label}»`} onClick={() => togglePin(event, key, pinned)}>
                      <Icon name={pinned ? "pin-angle-fill" : "pin-angle"} size={17} />
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function emptyActivityMessage(filter: ActivityFilter): string {
  if (filter === "pinned") return "Нет закрепленных событий";
  return filter ? "Нет событий выбранного типа" : "Событий пока нет";
}
