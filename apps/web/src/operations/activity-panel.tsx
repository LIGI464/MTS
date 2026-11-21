import * as Dialog from "@radix-ui/react-dialog";
import { ArrowUpRight, CircleCheck, CirclePlus, RotateCcw, ShieldAlert, Users, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { ActivityEvent, IncidentAlert } from "./activity";
import styles from "./dashboard.module.css";

const eventTypes = {
  "incident.new": { label: "Новый инцидент", icon: CirclePlus, tone: "info" },
  "critical.new": { label: "Новый критический инцидент", icon: ShieldAlert, tone: "critical" },
  "coordinator.assigned": { label: "Передан группе координаторов", icon: Users, tone: "info" },
  "coordinator.changed": { label: "Координатор изменён", icon: Users, tone: "info" },
  "critical.resolved": { label: "Критический инцидент решён", icon: CircleCheck, tone: "success" },
  "demo.reset": { label: "Набор восстановлен", icon: RotateCcw, tone: "neutral" },
} satisfies Record<ActivityEvent["kind"], { label: string; icon: typeof Users; tone: string }>;

const clock = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
});

export function ActivityPanel({ events, unreadCount, highlight, markRead, onInspect, children }: {
  events: readonly ActivityEvent[];
  unreadCount: number;
  highlight: IncidentAlert | null;
  markRead: () => void;
  onInspect: (id: string) => void;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"" | ActivityEvent["kind"]>("");
  const visible = kind ? events.filter((event) => event.kind === kind) : events;

  useEffect(() => {
    if (open && unreadCount > 0) markRead();
  }, [markRead, open, unreadCount]);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      {children}
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="detail" data-surface="surface">
          <div className="detail-heading">
            <div>
              <Dialog.Title>События</Dialog.Title>
              <Dialog.Description className={styles.eventDescription}>Время событий указано по Москве</Dialog.Description>
            </div>
            <Dialog.Close className="detail-close" aria-label="Закрыть события"><X size={21} aria-hidden /></Dialog.Close>
          </div>
          <label className={`${styles.field} ${styles.eventFilter}`}>
            Тип события
            <select value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}>
              <option value="">Все типы</option>
              {Object.entries(eventTypes).map(([value, { label }]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          {visible.length === 0 ? (
            <p className={styles.empty}>{kind ? "Нет событий выбранного типа" : "Событий пока нет"}</p>
          ) : (
            <ol className={styles.events}>
              {visible.map((event) => {
                const { icon: Icon, label, tone } = eventTypes[event.kind];
                const id = event.incidentId;
                return (
                  <li key={event.key} className={styles.event} data-fresh={highlight?.eventKeys.has(event.key) || undefined}>
                    <span className={styles.symbol} data-tone={tone}><Icon size={17} aria-hidden /></span>
                    <div className={styles.eventInfo}>
                      <div className={styles.eventTop}>
                        <strong>{label}</strong>
                        <time dateTime={event.at}>{clock.format(new Date(event.at))}</time>
                      </div>
                      {id ? (
                        <button type="button" className={styles.eventLink} onClick={() => onInspect(id)}>
                          {event.title && event.title !== label ? event.title : id}
                          <ArrowUpRight size={14} aria-hidden />
                        </button>
                      ) : event.title && event.title !== label ? <p>{event.title}</p> : null}
                      {id && event.title && event.title !== label ? <small data-numeric="tabular">{id}</small> : null}
                    </div>
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
