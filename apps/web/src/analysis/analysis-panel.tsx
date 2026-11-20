import type { AnalysisResult, Incident } from "@mts/contracts";
import { useEffect, useState } from "react";

export function AnalysisPanel({
  incident,
  runAnalysis,
  operatorToken,
}: {
  incident: Incident;
  runAnalysis: (id: string, token?: string) => Promise<AnalysisResult>;
  operatorToken: string | undefined;
}) {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setResult(null);
    setError(null);
  }, [incident.id, incident.version]);

  async function analyze() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const next = await runAnalysis(incident.id, operatorToken);
      if (next.incidentId !== incident.id || next.incidentVersion !== incident.version) return;
      setResult(next);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось выполнить анализ");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="analysis">
      <h2>ИИ-анализ</h2>
      <button type="button" disabled={pending} onClick={() => void analyze()}>
        {pending ? "Анализ выполняется" : "ИИ-анализ"}
      </button>
      {error ? <p>{error}</p> : null}
      {result ? (
        <>
          <p>{result.summary}</p>
          <p>{result.recommendedTeam?.name ?? "Команда не определена"}</p>
          <p>{result.source === "llm" ? "codex.sale" : "Локальные правила"}</p>
        </>
      ) : null}
    </section>
  );
}
