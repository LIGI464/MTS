import type { AnalysisResult, Incident } from "@mts/contracts";
import { useEffect, useRef, useState } from "react";
import { analysisView, explainFactor, reasonLabel, reduceAnalysis, riskLabel, sourceLabel } from "./state";
import styles from "./analysis.module.css";

export function AnalysisPanel({
  incident,
  runAnalysis,
  operatorToken,
}: {
  incident: Incident;
  runAnalysis: (id: string, token?: string) => Promise<AnalysisResult>;
  operatorToken: string | undefined;
}) {
  const [state, setState] = useState(() => analysisView(incident));
  const requestRef = useRef(0);
  const pendingRef = useRef(false);

  useEffect(() => {
    requestRef.current += 1;
    pendingRef.current = false;
    setState(analysisView(incident));
  }, [incident.id, incident.version]);

  async function analyze() {
    if (pendingRef.current) return;
    pendingRef.current = true;
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setState((current) => reduceAnalysis(current, { type: "start" }));
    try {
      const result = await runAnalysis(incident.id, operatorToken);
      if (requestRef.current !== requestId) return;
      setState((current) => reduceAnalysis(current, { type: "success", result }));
    } catch (caught) {
      if (requestRef.current !== requestId) return;
      const message = caught instanceof Error ? caught.message : "Не удалось выполнить анализ";
      setState((current) => reduceAnalysis(current, { type: "failure", message }));
    } finally {
      if (requestRef.current === requestId) pendingRef.current = false;
    }
  }

  const result = state.result;

  return (
    <section className={styles.panel} aria-label="ИИ-анализ">
      <div className={styles.toolbar}>
        <button
          type="button"
          className={styles.launch}
          disabled={state.phase === "pending"}
          onClick={() => void analyze()}
        >
          {state.phase === "pending" ? "Анализ выполняется" : "ИИ-анализ"}
        </button>
      </div>
      {state.phase === "pending" ? <p className={styles.status}>Анализ выполняется</p> : null}
      {state.phase === "error" ? (
        <p className={styles.error} role="alert">
          <span>{state.error}</span>
          <button type="button" onClick={() => void analyze()}>
            Повторить
          </button>
        </p>
      ) : null}
      {result ? (
        <div className={styles.result}>
          <p className={styles.summary}>{result.summary}</p>
          <p className={styles.recommendation}>{result.recommendedTeam?.name ?? "Команда не определена"}</p>
          {result.recommendedTeam ? <p className={styles.recommendation}>{result.recommendedTeam.reason}</p> : null}
          <p className={styles.recommendation}>Риск: {riskLabel(result.risk.level, result.reason)}</p>
          {result.risk.factors.length > 0 ? (
            <ul className={styles.recommendation}>
              {result.risk.factors.map((factor) => (
                <li key={factor}>{explainFactor(factor)}</li>
              ))}
            </ul>
          ) : null}
          {result.reason && result.risk.level !== "not_applicable" ? (
            <p className={styles.recommendation}>{reasonLabel(result.reason)}</p>
          ) : null}
          <p className={styles.source}>{sourceLabel(result.source)}</p>
        </div>
      ) : null}
    </section>
  );
}
