import { useQuery } from "@tanstack/react-query";
import type { useDashboard } from "../data";
import { fetchImportAvailability } from "../data/import-api";
import { fetchRegistry } from "../itsm/api";
import { AppShell } from "../shell";
import { createDeveloperTransport } from "./client";
import { DeveloperPage } from "./developer-page";
import { developerMode } from "./model";

const transport = createDeveloperTransport(fetch);

export function DeveloperRoute({ dashboard, operatorToken, onOperatorToken }: {
  dashboard: ReturnType<typeof useDashboard>;
  operatorToken: string | undefined;
  onOperatorToken: (token: string | undefined) => void;
}) {
  const { snapshot, connection } = dashboard;
  const mode = developerMode({ mock: connection === "mock", demoReset: snapshot?.capabilities.demoReset === true });
  const registry = useQuery({
    queryKey: ["itsm", "registry", snapshot?.revision],
    queryFn: ({ signal }) => fetchRegistry(signal),
    enabled: mode === "live",
  });
  const importAvailability = useQuery({
    queryKey: ["incident-import-availability"],
    enabled: Boolean(snapshot) && connection !== "mock",
    queryFn: ({ signal }) => fetchImportAvailability(signal),
    staleTime: 60_000,
  });
  if (!snapshot) {
    return (
      <AppShell title="Разработчикам">
        <p role="status">{connection === "connecting" ? "Загружаем снимок…" : "Снимок недоступен"}</p>
      </AppShell>
    );
  }

  // The dashboard version tracks display data. Mutations use the archive version from ITSM.
  const versions = new Map(registry.data?.items.map(({ id, version }) => [id, version]));
  const incidents = snapshot.incidents.map((incident) => ({ ...incident, version: versions.get(incident.id) ?? "" }));
  return (
    <AppShell title={null}>
      {registry.isError ? (
        <p className="banner" role="alert">
          Не удалось загрузить версии заявок из ITSM.{" "}
          <button type="button" onClick={() => void registry.refetch()}>Повторить</button>
        </p>
      ) : null}
      <DeveloperPage
        stand={{ mode, sourceStatus: snapshot.source.status, incidents }}
        transport={transport}
        service={{
          enabled: snapshot.capabilities.demoReset,
          liveAnalysis: snapshot.capabilities.liveAnalysis,
          importEnabled: importAvailability.data === true,
          sseRevision: dashboard.sseRevision,
          reconnecting: connection === "reconnecting",
          operatorToken,
          onOperatorToken,
          onReset: dashboard.resetDemo,
        }}
      />
    </AppShell>
  );
}
