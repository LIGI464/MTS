import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { DeveloperRoute } from "./developers/developer-route";
import { ItsmPage } from "./itsm";
import { registryPath } from "./itsm/api";
import { AppShell } from "./shell";
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
  const pathname = window.location.pathname.replace(/\/$/, "") || "/";
  if (pathname === "/" || pathname === "/admin/incidents") return <App />;
  if (pathname === "/admin/developers") return <DeveloperRoute />;
  if (pathname === registryPath) return <AppShell title={null}><ItsmPage /></AppShell>;

  const encodedId = pathname.startsWith(registryPath + "/") ? pathname.slice(registryPath.length + 1) : "";
  if (encodedId && !encodedId.includes("/")) {
    const id = decodeId(encodedId);
    if (id) return <AppShell title={null}><ItsmPage id={id} /></AppShell>;
  }
  return <AppShell title="Страница не найдена"><a href="/admin/incidents">На пульт</a></AppShell>;
}

function decodeId(value: string) {
  try { return decodeURIComponent(value); } catch { return null; }
}
