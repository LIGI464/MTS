import * as Dialog from "@radix-ui/react-dialog";
import { useRef, useState } from "react";
import { Icon } from "../icons";
import { ImportDialog } from "./import-dialog";
import { isTokenError, reduceReset, type ResetView } from "./state";
import styles from "./demo.module.css";

export function DemoControls({
  enabled,
  liveAnalysis,
  importEnabled,
  sseRevision,
  reconnecting,
  busy,
  operatorToken,
  onOperatorToken,
  onReset,
}: {
  enabled: boolean;
  liveAnalysis: boolean;
  importEnabled: boolean;
  sseRevision: number | null;
  reconnecting: boolean;
  busy: boolean;
  operatorToken: string | undefined;
  onOperatorToken: (token: string | undefined) => void;
  onReset: (token: string) => Promise<unknown>;
}) {
  const [resetState, setResetState] = useState<ResetView>({ phase: "idle", message: null });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const pendingRef = useRef(false);
  if (!enabled && !liveAnalysis && !importEnabled) return null;

  async function confirmReset() {
    if (pendingRef.current || busy) return;
    if (!operatorToken || operatorToken.trim().length === 0) {
      setResetState((current) => reduceReset(current, { type: "token-rejected" }));
      setConfirmOpen(false);
      return;
    }
    pendingRef.current = true;
    setResetState((current) => reduceReset(current, { type: "submit" }));
    try {
      await onReset(operatorToken.trim());
      setResetState(reduceReset({ phase: "pending", message: null }, { type: "success" }));
      setConfirmOpen(false);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Не удалось сбросить набор";
      setResetState(
        reduceReset(
          { phase: "pending", message: null },
          isTokenError(caught) ? { type: "token-rejected" } : { type: "failure", message },
        ),
      );
      setConfirmOpen(false);
    } finally {
      pendingRef.current = false;
    }
  }

  return (
    <section className={styles.service} aria-labelledby="service-heading">
      <h2 id="service-heading"><Icon name="gear" size={18} />Служебное</h2>
      <label className={styles.field}>
        Токен оператора
        <input
          type="password"
          autoComplete="off"
          disabled={busy}
          aria-invalid={resetState.phase === "error" ? true : undefined}
          value={operatorToken ?? ""}
          onChange={(event) => onOperatorToken(event.target.value.length > 0 ? event.target.value : undefined)}
        />
      </label>
      <div className={styles.actions}>
        <button type="button" disabled={busy} onClick={() => onOperatorToken(undefined)}>
          Очистить
        </button>
        {importEnabled ? <ImportDialog operatorToken={operatorToken} sseRevision={sseRevision} reconnecting={reconnecting} /> : null}
        {enabled ? (
          <Dialog.Root
            open={confirmOpen}
            onOpenChange={(open) => {
              if (pendingRef.current) return;
              setConfirmOpen(open);
              setResetState((current) => reduceReset(current, open ? { type: "open" } : { type: "cancel" }));
            }}
          >
            <Dialog.Trigger asChild>
              <button type="button" disabled={busy}>
                Сбросить демо
              </button>
            </Dialog.Trigger>
            <Dialog.Portal>
              <Dialog.Overlay className={styles.overlay} />
              <Dialog.Content className={styles.confirm} data-surface="surface">
                <Dialog.Title className={styles.confirmTitle}>Сбросить демо</Dialog.Title>
                <Dialog.Description className={styles.confirmText}>
                  Сервер вернёт демонстрационный набор к исходной копии. История ITSM сохранится.
                </Dialog.Description>
                <div className={styles.actions}>
                  <button type="button" disabled={resetState.phase === "pending"} onClick={() => void confirmReset()}>
                    Подтвердить сброс
                  </button>
                  <Dialog.Close className={styles.quiet} disabled={resetState.phase === "pending"}>
                    Отмена
                  </Dialog.Close>
                </div>
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
        ) : null}
      </div>
      {resetState.message ? (
        <p
          className={resetState.phase === "error" ? styles.messageError : styles.message}
          role={resetState.phase === "error" ? "alert" : "status"}
        >
          {resetState.message}
        </p>
      ) : null}
    </section>
  );
}
