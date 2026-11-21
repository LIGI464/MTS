import { API_PREFIX, SnapshotSchema } from "@mts/contracts";
import { useEffect, useState } from "react";

type ItsmSnapshot = { revision: number | null; operatorEnabled: boolean };

export function useItsmSnapshot(subscribe: boolean): ItsmSnapshot {
  const [snapshot, setSnapshot] = useState<ItsmSnapshot>({ revision: null, operatorEnabled: false });
  useEffect(() => {
    if (!subscribe || typeof EventSource === "undefined" || import.meta.env.VITE_DATA_MODE === "mock") return;
    const source = new EventSource(`${API_PREFIX}/events`);

    function onDashboard(event: MessageEvent<string>) {
      try {
        const parsed = SnapshotSchema.safeParse(JSON.parse(event.data));
        if (!parsed.success) return;
        const { revision, capabilities } = parsed.data;
        const operatorEnabled = capabilities.demoReset;
        setSnapshot((current) => current.revision === revision && current.operatorEnabled === operatorEnabled
          ? current : { revision, operatorEnabled });
      } catch {
        // The next valid dashboard event can still refresh the current page.
      }
    }

    source.addEventListener("dashboard", onDashboard);
    return () => source.close();
  }, [subscribe]);
  return snapshot;
}
