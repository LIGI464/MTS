import * as Dialog from "@radix-ui/react-dialog";
import { CircleAlert, CircleCheck, Upload, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { DashboardRequestError } from "../data/api";
import { requestImportApply, requestImportPreview } from "../data/import-api";
import { importFailure, tokenRequired, type ImportState, type ValidPreview } from "./import-state";
import { describeImportIssues, type ImportIssue } from "./import-validation";
import styles from "./demo.module.css";

const maxFileBytes = 2 * 1024 * 1024;
const priorities = [[4, "Критический"], [3, "Высокий"], [2, "Средний"], [1, "Низкий"]] as const;

export function ImportDialog({ operatorToken, sseRevision, reconnecting }: {
  operatorToken?: string;
  sseRevision: number | null;
  reconnecting: boolean;
}) {
  const fileInput = useId();
  const [file, setFile] = useState<File | null>(null);
  const [state, setState] = useState<ImportState>({ phase: "idle" });
  const previewRequest = useRef<AbortController | null>(null);
  const applying = useRef(false);
  const stateAccepted = state.phase === "submitted" && sseRevision !== null && sseRevision >= state.revision;
  const waiting = state.phase === "submitted" && !stateAccepted;
  const locked = state.phase === "applying" || waiting;

  useEffect(() => () => previewRequest.current?.abort(), []);

  function selectFile(next: File | null) {
    if (applying.current || waiting) return;
    previewRequest.current?.abort();
    previewRequest.current = null;
    setFile(next);
    setState({ phase: "idle" });
  }

  async function checkFile() {
    if (!file || locked || previewRequest.current) return;
    const token = operatorToken?.trim();
    if (!token) {
      setState({ phase: "check-error", message: tokenRequired });
      return;
    }
    if (file.size > maxFileBytes) {
      setState({ phase: "check-error", message: "Размер файла превышает 2 МиБ." });
      return;
    }
    const request = new AbortController();
    previewRequest.current = request;
    setState({ phase: "checking" });
    try {
      let jsonText: string;
      try {
        jsonText = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
      } catch {
        if (!request.signal.aborted) {
          setState({ phase: "check-error", message: "Не удалось прочитать файл. Выберите JSON в кодировке UTF-8." });
        }
        return;
      }
      if (request.signal.aborted) return;
      const result = await requestImportPreview({ fileName: file.name, jsonText }, token, request.signal);
      if (request.signal.aborted) return;
      setState(result.valid
        ? { phase: "review", preview: result }
        : { phase: "invalid", issues: describeImportIssues(jsonText, result.errors) });
    } catch (caught) {
      if (!request.signal.aborted) setState({ phase: "check-error", message: importFailure(caught, "preview") });
    } finally {
      if (previewRequest.current === request) previewRequest.current = null;
    }
  }

  async function confirmImport() {
    if (state.phase !== "review" || applying.current) return;
    const token = operatorToken?.trim();
    if (!token) {
      setState({ ...state, error: tokenRequired });
      return;
    }
    const { preview } = state;
    const requestId = state.requestId ?? crypto.randomUUID();
    applying.current = true;
    setState({ phase: "applying", preview, requestId });
    try {
      const { revision } = await requestImportApply({
        previewId: preview.previewId,
        expectedRevision: preview.expectedRevision,
        requestId,
      }, token);
      setState({ phase: "submitted", revision });
    } catch (caught) {
      if (caught instanceof DashboardRequestError && caught.status === 409) {
        const message = caught.code === "REVISION_CONFLICT"
          ? "Данные изменились после предпросмотра. Проверьте файл заново."
          : caught.message;
        setState({ phase: "conflict", message });
      } else {
        setState({ phase: "review", preview, requestId, error: importFailure(caught, "apply") });
      }
    } finally {
      applying.current = false;
    }
  }

  return (
    <Dialog.Root>
      <Dialog.Trigger asChild><button type="button">Загрузить JSON</button></Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content className={styles.importDialog} data-surface="surface">
          <header className={styles.importHeader}>
            <span className={styles.importIcon}><Upload size={20} aria-hidden /></span>
            <div>
              <Dialog.Title className={styles.importTitle}>Загрузить JSON</Dialog.Title>
              <Dialog.Description className={styles.importDescription}>
                Проверьте выгрузку инцидентов перед заменой рабочего набора.
              </Dialog.Description>
            </div>
            <Dialog.Close className={styles.importClose} aria-label="Закрыть импорт"><X size={20} aria-hidden /></Dialog.Close>
          </header>
          <div className={styles.importBody}>
            <div className={styles.fileRow}>
              <div className={styles.fileField}>
                <label htmlFor={fileInput}>Файл JSON</label>
                <div className={styles.fileControl} data-disabled={locked || undefined}>
                  <input id={fileInput} type="file" accept=".json,application/json" disabled={locked}
                    aria-describedby={`${fileInput}-name`}
                    onChange={(event) => selectFile(event.target.files?.[0] ?? null)} />
                  <span className={styles.fileChoose} aria-hidden>Выбрать файл</span>
                  <span id={`${fileInput}-name`} className={styles.fileName} title={file?.name}>
                    {file?.name ?? "Файл не выбран"}
                  </span>
                </div>
              </div>
              <button type="button" className={styles.importButton}
                disabled={!file || state.phase === "checking" || locked}
                data-primary={state.phase !== "review" || undefined}
                onClick={() => void checkFile()}>
                {state.phase === "conflict" ? "Проверить заново" : "Проверить файл"}
              </button>
            </div>

            {state.phase === "checking" ? <p role="status" className={styles.importFeedback}>Проверяем файл…</p> : null}
            {state.phase === "check-error" || state.phase === "conflict" ? (
              <p role="alert" className={styles.importFeedback} data-tone={state.phase === "conflict" ? "warning" : "error"}>
                {state.message}
              </p>
            ) : null}
            {state.phase === "invalid" ? <ImportErrors issues={state.issues} /> : null}
            {state.phase === "review" || state.phase === "applying" ? (
              <>
                <ImportPreview preview={state.preview} />
                {state.error ? <p role="alert" className={styles.importFeedback} data-tone="error">{state.error}</p> : null}
              </>
            ) : null}
            {state.phase === "submitted" ? (
              <p role="status" className={styles.importFeedback} data-tone={stateAccepted ? "success" : undefined}>
                {stateAccepted ? <CircleCheck size={19} aria-hidden /> : null}
                {stateAccepted ? `Импорт завершён. Ревизия ${state.revision} принята.`
                  : reconnecting ? "Ждём обновление снимка после переподключения…"
                  : `Ждём обновление снимка до ревизии ${state.revision}…`}
              </p>
            ) : null}
          </div>
          {state.phase === "review" || state.phase === "applying" ? (
            <footer className={styles.importFooter}>
              {state.phase === "applying" ? <span role="status">Применяем импорт…</span> : null}
              <button type="button" className={styles.importButton} data-primary disabled={state.phase === "applying"}
                onClick={() => void confirmImport()}>
                {state.error && state.requestId ? "Повторить подтверждение" : "Подтвердить импорт"}
              </button>
            </footer>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ImportErrors({ issues }: { issues: readonly ImportIssue[] }) {
  return (
    <section aria-label="Ошибки в файле">
      <div className={styles.importFeedback} data-tone="error" role="status">
        <CircleAlert size={20} aria-hidden />
        <div>
          <h3>Ошибки в файле ({issues.length})</h3>
          <p>Исправьте указанные поля и выберите обновлённый файл.</p>
        </div>
      </div>
      <ol className={styles.issueList}>
        {issues.map(({ row, id, path, reason }, index) => (
          <li key={index} className={styles.issue}>
            <div className={styles.issueLocation}>
              <strong>{row === null ? "Файл" : `Запись ${row}`}</strong>
              {id !== null ? <span>{id}</span> : null}
            </div>
            <code className={styles.issuePath}>{path}</code>
            <p>{reason}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function ImportPreview({ preview }: { preview: ValidPreview }) {
  return (
    <section className={styles.importPreview} aria-label="Предпросмотр импорта">
      <div className={styles.previewHeading}>
        <h3>Предпросмотр импорта</h3>
        <span role="status" data-numeric="tabular">Всего записей <strong>{preview.total}</strong></span>
      </div>
      <dl className={styles.priorityCounts} aria-label="Записи по приоритетам" data-numeric="tabular">
        {priorities.map(([id, label]) => (
          <div key={id} data-priority={id}><dt>{label}</dt><dd>{preview.byPriority[id]}</dd></div>
        ))}
      </dl>
      <dl className={styles.changeCounts} aria-label="Изменения после импорта" data-numeric="tabular">
        <div><dt>Добавятся</dt><dd>{preview.added}</dd></div>
        <div><dt>Изменятся</dt><dd>{preview.updated}</dd></div>
        <div><dt>Уйдут в архив</dt><dd>{preview.archived}</dd></div>
      </dl>
    </section>
  );
}
