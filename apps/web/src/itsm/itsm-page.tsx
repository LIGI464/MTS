import { PRIORITY_LABELS, isActiveState, type HistoryEntry, type TicketDetail, type TicketSummary } from "@mts/contracts";
import { keepPreviousData, queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, History, Search } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { formatMoscow } from "../board/format";
import { fetchRegistry, fetchTicket, ItsmRequestError, registryPath, ticketPath } from "./api";
import { filterTickets } from "./model";
import { ResolvePanel } from "./resolve-panel";
import { useItsmSnapshot } from "./use-itsm-snapshot";
import styles from "./itsm.module.css";

const historyDate = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Europe/Moscow", dateStyle: "short", timeStyle: "medium",
});

export type ItsmPageProps = {
  id?: string;
  /** Pass null while the host dashboard connects, or omit to subscribe here. */
  revision?: number | null;
  operatorEnabled?: boolean;
  operatorToken?: string;
};

export function ItsmPage({ id, revision, operatorEnabled, operatorToken }: ItsmPageProps) {
  const live = useItsmSnapshot(revision === undefined);
  const currentRevision = revision === undefined ? live.revision : revision;
  const [localToken, setLocalToken] = useState<string>();
  const token = operatorToken?.trim() || localToken;
  const enabled = operatorEnabled ?? (live.operatorEnabled || Boolean(operatorToken?.trim()));

  return (
    <div className={styles.page}>
      <header className={styles.masthead}>
        <div className={styles.mastheadInner}>
          <p className={styles.brand}><strong>Локальная ITSM</strong><span>Команда goida-code</span></p>
          <a className={styles.dashboardLink} href="/admin/incidents">На пульт <ArrowRight size={16} aria-hidden="true" /></a>
        </div>
      </header>
      <div className={styles.container}>
        {id === undefined ? <Registry revision={currentRevision} /> : (
          <TicketPage
            key={id}
            id={id}
            revision={currentRevision}
            operatorToken={enabled ? token : undefined}
            onLocalToken={enabled && !operatorToken?.trim() ? setLocalToken : undefined}
          />
        )}
      </div>
    </div>
  );
}

function Registry({ revision }: { revision: number | null }) {
  const searchId = useId();
  const [search, setSearch] = useState("");
  const query = useQuery({
    queryKey: ["itsm", "registry", revision],
    queryFn: ({ signal }) => fetchRegistry(signal),
    placeholderData: keepPreviousData,
    retry: false,
  });
  const items = query.data?.items;
  const shown = items && filterTickets(items, search);

  return (
    <section aria-labelledby={`${searchId}-title`}>
      <div className={styles.pageTitle}>
        <h1 id={`${searchId}-title`}>Реестр обращений</h1>
        <p>Текущие заявки и архив</p>
      </div>
      <div className={styles.registry}>
        <div className={styles.toolbar}>
          <div className={styles.search}>
            <label htmlFor={searchId}>Поиск обращений</label>
            <div className={styles.searchControl}>
              <Search size={19} aria-hidden="true" />
              <input type="search" id={searchId} value={search} onChange={(event) => setSearch(event.target.value)}
                placeholder="Номер, название или продукт" />
            </div>
          </div>
          {items && shown ? <p className={styles.resultCount} role="status">Показано {shown.length} из {items.length}</p> : null}
        </div>
        {query.isPending ? <p className={styles.empty} role="status">Загружаем реестр…</p> : null}
        {query.isError ? <RequestProblem message="Не удалось загрузить реестр." retry={() => void query.refetch()} /> : null}
        {items?.length === 0 ? <p className={styles.empty}>В реестре пока нет обращений.</p> : null}
        {items && items.length > 0 && shown?.length === 0 ? <p className={styles.empty}>По запросу ничего не найдено.</p> : null}
        {shown && shown.length > 0 ? (
          <>
            <div className={styles.columnHead} aria-hidden="true">
              <span>Обращение</span><span>Продукт</span><span>Статус</span><span>Решение</span>
            </div>
            <ul className={styles.rows} aria-label="Обращения">
              {shown.map((ticket) => (
                <li className={styles.row} key={ticket.id}>
                  <div className={styles.rowTitle}>
                    <a className={styles.ticketLink} href={ticketPath(ticket.id)}>{ticket.id}</a>
                    <p>{ticket.title}</p>
                  </div>
                  <div className={styles.product}><span className={styles.mobileLabel}>Продукт</span>{ticket.product ?? "Не указан"}</div>
                  <div className={styles.tags}><TicketStatus ticket={ticket} /></div>
                  <div className={styles.solutionTag} data-solution={ticket.hasSolution}>
                    {ticket.hasSolution === undefined ? "Сведения о решении недоступны" : ticket.hasSolution ? "Решение есть" : "Решение не указано"}
                  </div>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </div>
    </section>
  );
}

function ticketQuery(id: string, revision: number | null) {
  return queryOptions({
    queryKey: ["itsm", "ticket", id, revision],
    queryFn: ({ signal }) => fetchTicket(id, signal),
    placeholderData: keepPreviousData,
    staleTime: 0,
    retry: false,
  });
}

function TicketPage({ id, revision, operatorToken, onLocalToken }: {
  id: string;
  revision: number | null;
  operatorToken?: string;
  onLocalToken?: (token?: string) => void;
}) {
  const client = useQueryClient();
  const [savedRevision, setSavedRevision] = useState<number | null>(null);
  const [lastDetail, setLastDetail] = useState<TicketDetail>();
  const effectiveRevision = savedRevision === null ? revision : Math.max(revision ?? 0, savedRevision);
  const query = useQuery(ticketQuery(id, effectiveRevision));
  useEffect(() => {
    if (query.data) setLastDetail(query.data);
  }, [query.data]);

  const detail = query.data ?? lastDetail;
  const missing = query.error instanceof ItsmRequestError && query.error.status === 404;

  function refresh(acceptedRevision?: number) {
    if (acceptedRevision === undefined) return client.fetchQuery(ticketQuery(id, effectiveRevision));
    const requestedRevision = Math.max(effectiveRevision ?? 0, acceptedRevision);
    setSavedRevision(requestedRevision);
    return client.fetchQuery(ticketQuery(id, requestedRevision));
  }

  return (
    <article>
      <a className={styles.back} href={registryPath}><ArrowLeft size={17} aria-hidden="true" /> К реестру</a>
      <div className={styles.pageTitle}>
        <p className={styles.incidentId}>{id}</p>
        <h1>{missing ? "Заявка не найдена" : detail?.ticket.title ?? "Карточка обращения"}</h1>
        {detail && !missing ? <div className={styles.tags}><TicketStatus ticket={detail.ticket} /></div> : null}
      </div>
      {query.isPending && !detail ? <p className={styles.empty} role="status">Загружаем карточку…</p> : null}
      {missing ? <p className={styles.empty} role="status">Проверьте номер или откройте обращение из реестра.</p> : null}
      {query.isError && !missing ? <RequestProblem message="Не удалось загрузить карточку." retry={() => void query.refetch()} /> : null}
      {detail && !missing ? (
        <div className={styles.cardGrid}>
          <div className={styles.cardMain}>
            <section className={styles.section} aria-label="Данные заявки">
              <h2>Данные заявки</h2>
              <dl className={styles.facts}>
                <div><dt>Продукт</dt><dd>{detail.ticket.product ?? "Не указан"}</dd></div>
                <div><dt>Сервис</dt><dd>{detail.ticket.service ?? "Не указан"}</dd></div>
                <div><dt>Команда</dt><dd>{detail.ticket.team ?? "Группа не назначена"}</dd></div>
                <div><dt>Исполнитель</dt><dd>{detail.ticket.assignee ?? "Исполнитель не назначен"}</dd></div>
                <div><dt>Приоритет</dt><dd>{PRIORITY_LABELS[detail.ticket.priority]} · {detail.ticket.priority}</dd></div>
                <div><dt>Регистрация (МСК)</dt><dd><MoscowTime value={detail.ticket.createdAt} /></dd></div>
                <div><dt>Срок (МСК)</dt><dd><MoscowTime value={detail.ticket.dueAt} fallback="Срок не задан" /></dd></div>
                {detail.ticket.resolvedAt ? <div><dt>Завершение (МСК)</dt><dd><MoscowTime value={detail.ticket.resolvedAt} /></dd></div> : null}
              </dl>
            </section>
            <section className={styles.section} aria-label="Описание и решение">
              <h2>Описание</h2>
              <p className={styles.prose}>{textOr(detail.description, "Описание не указано")}</p>
              <h2>Решение</h2>
              <p className={styles.prose}>{textOr(detail.solution, "Решение не указано")}</p>
            </section>
            <ResolvePanel ticket={detail.ticket} operatorToken={operatorToken} refresh={refresh} />
            {onLocalToken && detail.ticket.present && isActiveState(detail.ticket.state) ? (
              <OperatorAccess tokenSet={Boolean(operatorToken)} onToken={onLocalToken} />
            ) : null}
          </div>
          <Timeline entries={detail.history} />
        </div>
      ) : null}
    </article>
  );
}

function TicketStatus({ ticket }: { ticket: TicketSummary }) {
  return <>
    <span className={styles.badge} data-state={ticket.state}>{ticket.stateLabel}</span>
    {!ticket.present ? <span className={styles.archiveBadge}>В архиве</span> : null}
  </>;
}

function MoscowTime({ value, fallback }: { value: string | null; fallback?: string }) {
  return value ? <time dateTime={value}>{formatMoscow(value)}</time> : fallback;
}

function textOr(value: string | null, fallback: string) {
  return value?.trim() ? value : fallback;
}

function Timeline({ entries }: { entries: HistoryEntry[] }) {
  const label = useId();
  return (
    <section className={styles.timeline} aria-labelledby={label}>
      <div className={styles.timelineHead}>
        <History size={20} aria-hidden="true" /><h2 id={label}>Хронология</h2><span>МСК</span>
      </div>
      {entries.length === 0 ? <p>Изменений пока нет.</p> : (
        <ol>
          {entries.map((entry) => (
            <li key={entry.version}>
              <time dateTime={entry.at}>{historyDate.format(new Date(entry.at))}</time>
              <p className={styles.timelineState}>{entry.stateLabel}{entry.present ? null : " · В архиве"}</p>
              <dl>
                <div><dt>Команда</dt><dd>{entry.team ?? "Группа не назначена"}</dd></div>
                <div><dt>Срок</dt><dd><MoscowTime value={entry.dueAt} fallback="Срок не задан" /></dd></div>
                <div><dt>Приоритет</dt><dd>{PRIORITY_LABELS[entry.priority]} · {entry.priority}</dd></div>
              </dl>
              <p className={styles.prose}><strong>Решение</strong>{"\n"}{textOr(entry.solution, "Решение не указано")}</p>
              {entry.description?.trim() ? (
                <details><summary>Описание этой версии</summary><p className={styles.prose}>{entry.description}</p></details>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function OperatorAccess({ tokenSet, onToken }: { tokenSet: boolean; onToken: (token?: string) => void }) {
  const inputId = useId();
  if (tokenSet) return <button className={styles.secondary} type="button" onClick={() => onToken()}>Выйти из режима оператора</button>;

  return (
    <details className={styles.operator}>
      <summary>Доступ оператора</summary>
      <form className={styles.resolveForm} onSubmit={(event) => {
        event.preventDefault();
        const value = new FormData(event.currentTarget).get("token");
        if (typeof value === "string" && value.trim()) onToken(value.trim());
      }}>
        <label htmlFor={inputId}>Токен оператора</label>
        <input type="password" name="token" id={inputId} required autoComplete="off" />
        <button className={styles.secondary} type="submit">Использовать токен</button>
      </form>
    </details>
  );
}

function RequestProblem({ message, retry }: { message: string; retry: () => void }) {
  return <div className={styles.empty}>
    <p role="alert">{message}</p>
    <button className={styles.secondary} type="button" onClick={retry}>Повторить загрузку</button>
  </div>;
}
