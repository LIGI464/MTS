import { useQuery } from "@tanstack/react-query";
import { useDashboard } from "../data";
import { fetchRegistry } from "../itsm/api";
import { AppShell } from "../shell";
import { createDeveloperTransport } from "./client";
import { DeveloperPage } from "./developer-page";
import { developerMode } from "./model";

const transport = createDeveloperTransport(fetch);

export function DeveloperRoute() {
  const { snapshot, connection } = useDashboard();
  const mode = developerMode({ mock: connection === "mock", demoReset: snapshot?.capabilities.demoReset === true });
  const registry = useQuery({
    queryKey: ["itsm", "registry", snapshot?.revision],
    queryFn: ({ signal }) => fetchRegistry(signal),
    enabled: mode === "live",
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
      />
    </AppShell>
  );
}
