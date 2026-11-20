import type { Snapshot } from "@mts/contracts";
import { useState } from "react";

export function DemoControls({
  enabled,
  liveAnalysis,
  operatorToken,
  onOperatorToken,
  onReset,
}: {
  enabled: boolean;
  liveAnalysis: boolean;
  operatorToken: string | undefined;
  onOperatorToken: (token: string | undefined) => void;
  onReset: (token: string) => Promise<Snapshot>;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  if (!enabled && !liveAnalysis) return null;

  async function reset() {
    if (pending) return;
    setPending(true);
    setMessage(null);
    try {
      await onReset(operatorToken ?? "");
      setMessage("Набор восстановлен");
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Не удалось сбросить набор");
    } finally {
      setPending(false);
    }
  }

  return (
    <details className="service">
      <summary>Служебное</summary>
      <label>
        Токен оператора
        <input
          type="password"
          value={operatorToken ?? ""}
          onChange={(event) => onOperatorToken(event.target.value.length > 0 ? event.target.value : undefined)}
        />
      </label>
      <button type="button" onClick={() => onOperatorToken(undefined)}>
        Очистить
      </button>
      {enabled ? (
        <button type="button" disabled={pending} onClick={() => void reset()}>
          Сбросить демо
        </button>
      ) : null}
      {message ? <p>{message}</p> : null}
    </details>
  );
}
