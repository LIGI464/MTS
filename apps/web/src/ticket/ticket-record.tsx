import type { Coordinator } from "@mts/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useState } from "react";
import { assignCoordinator, fetchCoordinators, fetchTicketDetail, TicketRequestError } from "./client";
import {
  assignmentFailure,
  assignmentHint,
  canAssign,
  coordinatorOutsideDirectory,
  directoryLoadFailure,
  formatRawFields,
  ticketLoadFailure,
} from "./model";
import styles from "./ticket.module.css";

export function TicketRecord({
  id,
  revision,
  operatorToken,
  onOperatorToken,
}: {
  id: string;
  revision: number | null;
  operatorToken?: string;
  onOperatorToken: (token: string | undefined) => void;
}) {
  const queryClient = useQueryClient();
  const selectId = useId();
  const tokenId = useId();
  const [choice, setChoice] = useState("");
  const [touched, setTouched] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const ticketQuery = useQuery({
    queryKey: ["itsm-ticket", id, revision],
    queryFn: ({ signal }) => fetchTicketDetail(fetch, id, signal),
    retry: false,
  });
  const directoryQuery = useQuery({
    queryKey: ["coordinators", revision],
    queryFn: ({ signal }) => fetchCoordinators(fetch, signal),
    retry: false,
  });
  const detail = ticketQuery.data;
  const directory = directoryQuery.data;
  const current = detail?.ticket.coordinator ?? null;

  useEffect(() => {
    if (touched || !current || !directory) return;
    if (directory.some((item) => item.id === current.id)) setChoice(current.id);
  }, [current, directory, touched]);

  const assign = useMutation({
    mutationFn: (coordinatorId: string) => {
      if (!detail) throw new TicketRequestError(409, "VERSION_CONFLICT");
      return assignCoordinator(fetch, id, operatorToken?.trim() ?? "", {
        coordinatorId,
        expectedVersion: detail.ticket.version,
        requestId: crypto.randomUUID(),
      });
    },
    onSuccess: async (result) => {
      setSaved(`Назначение сохранено. Версия ${result.version}.`);
      setFailure(null);
      await queryClient.invalidateQueries({ queryKey: ["itsm-ticket", id] });
    },
    onError: (error) => {
      const requestError = error instanceof TicketRequestError ? error : null;
      setSaved(null);
      setFailure(assignmentFailure(requestError?.status ?? 0, requestError?.code));
      if (requestError?.code === "COORDINATOR_NOT_FOUND") {
        void queryClient.invalidateQueries({ queryKey: ["coordinators"] });
      }
      if (requestError && (requestError.status === 409 || requestError.status === 404)) {
        void queryClient.invalidateQueries({ queryKey: ["itsm-ticket", id] });
      }
    },
  });

  const hint = detail && directory
    ? assignmentHint({
      present: detail.ticket.present,
      directoryEmpty: directory.length === 0,
      token: operatorToken ?? "",
      coordinatorId: choice,
      currentId: current?.id ?? null,
      pending: assign.isPending,
    })
    : null;
  const ready = Boolean(detail && directory && canAssign({
    present: detail?.ticket.present ?? false,
    directoryEmpty: (directory?.length ?? 0) === 0,
    token: operatorToken ?? "",
    coordinatorId: choice,
    currentId: current?.id ?? null,
    pending: assign.isPending,
  }));

  return (
    <div className={styles.record}>
      <Fields
        pending={ticketQuery.isPending}
        error={ticketQuery.error}
        fields={detail ? formatRawFields(detail.rawFields) : null}
        onRetry={() => void ticketQuery.refetch()}
      />
      <CoordinatorForm
        selectId={selectId}
        tokenId={tokenId}
        pending={directoryQuery.isPending || ticketQuery.isPending}
        directoryError={directoryQuery.isError}
        directory={directory}
        current={current}
        outside={directory ? coordinatorOutsideDirectory(directory, current) : false}
        archived={detail ? !detail.ticket.present : false}
        choice={choice}
        token={operatorToken ?? ""}
        hint={hint}
        failure={failure}
        saved={saved}
        ready={ready}
        submitting={assign.isPending}
        onRetry={() => void directoryQuery.refetch()}
        onChoice={(value) => {
          setTouched(true);
          setChoice(value);
          setSaved(null);
        }}
        onToken={(value) => onOperatorToken(value.length > 0 ? value : undefined)}
        onSubmit={() => {
          if (!ready) return;
          setSaved(null);
          setFailure(null);
          assign.mutate(choice);
        }}
      />
    </div>
  );
}

function Fields({
  pending,
  error,
  fields,
  onRetry,
}: {
  pending: boolean;
  error: unknown;
  fields: ReturnType<typeof formatRawFields> | null;
  onRetry: () => void;
}) {
  return (
    <section className={styles.section}>
      <h2>Все поля заявки</h2>
      <p className={styles.hint}>Исходная строка, включая пустые, нулевые и служебные значения.</p>
      {pending && !fields ? <p className={styles.hint} role="status">Загружаем поля заявки…</p> : null}
      {error ? (
        <LoadProblem
          message={ticketLoadFailure(error instanceof TicketRequestError ? error.status : 0)}
          onRetry={onRetry}
        />
      ) : null}
      {fields && fields.length === 0 ? <p className={styles.hint}>В карточке нет исходных полей.</p> : null}
      {fields && fields.length > 0 ? (
        <dl className={styles.fields}>
          {fields.map((field) => (
            <div key={field.key}>
              <dt>{field.key}</dt>
              <dd>
                <span className={styles.type}>{field.type}</span>
                <span>{field.text}</span>
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </section>
  );
}

function CoordinatorForm({
  selectId,
  tokenId,
  pending,
  directoryError,
  directory,
  current,
  outside,
  archived,
  choice,
  token,
  hint,
  failure,
  saved,
  ready,
  submitting,
  onRetry,
  onChoice,
  onToken,
  onSubmit,
}: {
  selectId: string;
  tokenId: string;
  pending: boolean;
  directoryError: boolean;
  directory?: readonly Coordinator[];
  current: Coordinator | null;
  outside: boolean;
  archived: boolean;
  choice: string;
  token: string;
  hint: string | null;
  failure: string | null;
  saved: string | null;
  ready: boolean;
  submitting: boolean;
  onRetry: () => void;
  onChoice: (value: string) => void;
  onToken: (value: string) => void;
  onSubmit: () => void;
}) {
  return (
    <section className={styles.section}>
      <h2>Персональный координатор</h2>
      {pending && !directory ? <p className={styles.hint} role="status">Загружаем справочник…</p> : null}
      {directoryError ? <LoadProblem message={directoryLoadFailure()} onRetry={onRetry} /> : null}
      {current ? <p className={styles.hint}>Сейчас в карточке: {current.name}</p> : <p className={styles.hint}>Персональный координатор не назначен.</p>}
      {outside ? <p className={styles.hint}>{current?.name} есть в карточке, но отсутствует в справочнике. Новое назначение выбирается из списка.</p> : null}
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <label htmlFor={selectId}>Координатор</label>
        <select
          id={selectId}
          value={choice}
          disabled={!directory || directory.length === 0 || archived || submitting}
          onChange={(event) => onChoice(event.target.value)}
        >
          <option value="">Выберите координатора</option>
          {directory?.map((item) => (
            <option key={item.id} value={item.id}>{item.name}</option>
          ))}
        </select>
        <label htmlFor={tokenId}>Токен оператора</label>
        <input
          id={tokenId}
          type="password"
          autoComplete="off"
          value={token}
          disabled={archived || submitting}
          onChange={(event) => onToken(event.target.value)}
        />
        {hint ? <p className={styles.hint}>{hint}</p> : null}
        {failure ? <p role="alert">{failure}</p> : null}
        {saved ? <p role="status">{saved}</p> : null}
        <button type="submit" disabled={!ready}>
          {submitting ? "Сохраняем назначение…" : "Назначить координатора"}
        </button>
      </form>
    </section>
  );
}

function LoadProblem({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className={styles.problem}>
      <p role="alert">{message}</p>
      <button type="button" onClick={onRetry}>Повторить загрузку</button>
    </div>
  );
}
