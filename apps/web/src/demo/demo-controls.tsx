import type { Snapshot } from "@mts/contracts";
import * as Dialog from "@radix-ui/react-dialog";
import { useRef, useState } from "react";
import { ImportDialog } from "./import-dialog";
import { isTokenError, reduceReset, type ResetView } from "./state";
import styles from "./demo.module.css";

export function DemoControls({
  enabled,
  liveAnalysis,
  importEnabled,
  sseRevision,
  reconnecting,
  operatorToken,
  onOperatorToken,
  onReset,
}: {
  enabled: boolean;
  liveAnalysis: boolean;
  importEnabled: boolean;
  sseRevision: number | null;
  reconnecting: boolean;
  operatorToken: string | undefined;
  onOperatorToken: (token: string | undefined) => void;
  onReset: (token: string) => Promise<Snapshot>;
}) {
  const [resetState, setResetState] = useState<ResetView>({ phase: "idle", message: null });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const pendingRef = useRef(false);
  if (!enabled && !liveAnalysis && !importEnabled) return null;

  async function confirmReset() {
    if (pendingRef.current || resetState.phase === "pending") return;
    if (!operatorToken || operatorToken.trim().length === 0) {
      setResetState((current) => reduceReset(current, { type: "token-rejected" }));
      setConfirmOpen(false);
      return;
    }
    pendingRef.current = true;
    setResetState((current) => reduceReset(current, { type: "submit" }));
    try {
      await onReset(operatorToken);
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
    <details className={styles.service}>
      <summary>Служебное</summary>
      <label className={styles.field}>
        Токен оператора
        <input
          type="password"
          autoComplete="off"
          aria-invalid={resetState.phase === "error" ? true : undefined}
          value={operatorToken ?? ""}
          onChange={(event) => onOperatorToken(event.target.value.length > 0 ? event.target.value : undefined)}
        />
      </label>
      <div className={styles.actions}>
        <button type="button" onClick={() => onOperatorToken(undefined)}>
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
              <button type="button" disabled={resetState.phase === "pending"}>
                Сбросить демо
              </button>
            </Dialog.Trigger>
            <Dialog.Portal>
              <Dialog.Overlay className={styles.overlay} />
              <Dialog.Content className={styles.confirm} data-surface="surface">
                <Dialog.Title className={styles.confirmTitle}>Сбросить демо</Dialog.Title>
                <Dialog.Description className={styles.confirmText}>
                  Сервер вернёт демонстрационный набор к исходной копии.
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
    </details>
  );
}
