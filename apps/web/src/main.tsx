import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { useDashboard } from "./data";
import { DeveloperRoute } from "./developers/developer-route";
import { ItsmPage } from "./itsm";
import { registryPath } from "./itsm/api";
import { useIncidentAlerts } from "./operations/use-incident-alerts";
import { useIncidentSound } from "./operations/use-incident-sound";
import { AppShell } from "./shell";
import { ProjectLink, ProjectNavigation } from "./shell/navigation";
import "./styles/theme.css";
import "./styles/base.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});
const root = document.getElementById("root");
if (!root) throw new Error("Не найден корневой элемент");

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Route />
    </QueryClientProvider>
  </StrictMode>,
);

function Route() {
  const [pathname, setPathname] = useState(readPath);
  const [operatorToken, onOperatorToken] = useState<string | undefined>();

  useEffect(() => {
    const updatePath = () => setPathname(readPath());
    window.addEventListener("popstate", updatePath);
    return () => window.removeEventListener("popstate", updatePath);
  }, []);

  function navigate(href: string) {
    const current = window.location.pathname + window.location.search + window.location.hash;
    if (current === href) return;
    window.history.pushState(null, "", href);
    setPathname(readPath());
    window.scrollTo(0, 0);
  }

  return (
    <ProjectNavigation.Provider value={navigate}>
      {pathname === "/" || pathname === "/admin/incidents" || pathname === "/admin/developers" ? (
        <DashboardRoutes developers={pathname === "/admin/developers"}
          operatorToken={operatorToken} onOperatorToken={onOperatorToken} />
      ) : (
        <OtherRoute pathname={pathname} />
      )}
    </ProjectNavigation.Provider>
  );
}

function DashboardRoutes({ developers, operatorToken, onOperatorToken }: {
  developers: boolean;
  operatorToken: string | undefined;
  onOperatorToken: (token: string | undefined) => void;
}) {
  const dashboard = useDashboard(operatorToken);
  const activity = useIncidentAlerts(dashboard.snapshot, dashboard.nowMs);
  const sound = useIncidentSound(activity.soundSequence);
  if (developers) return <DeveloperRoute dashboard={dashboard} operatorToken={operatorToken} onOperatorToken={onOperatorToken} />;
  return <App dashboard={dashboard} operatorToken={operatorToken} activity={activity} sound={sound} />;
}

function OtherRoute({ pathname }: { pathname: string }) {
  if (pathname === registryPath) return <AppShell title={null}><ItsmPage /></AppShell>;

  const encodedId = pathname.startsWith(registryPath + "/") ? pathname.slice(registryPath.length + 1) : "";
  if (encodedId && !encodedId.includes("/")) {
    const id = decodeId(encodedId);
    if (id) return <AppShell title={null}><ItsmPage id={id} /></AppShell>;
  }
  return <AppShell title="Страница не найдена"><ProjectLink href="/admin/incidents">На пульт</ProjectLink></AppShell>;
}

function readPath() {
  return window.location.pathname.replace(/\/$/, "") || "/";
}

function decodeId(value: string) {
  try { return decodeURIComponent(value); } catch { return null; }
}
