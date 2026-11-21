import type { ReactNode } from "react";
import { Icon, type IconName } from "../icons";
import logo from "./mts-logo.svg";
import { ProjectLink } from "./navigation";
import styles from "./shell.module.css";

const sections = [
  { label: "Пульт", href: "/admin/incidents", icon: "grid-1x2" },
  { label: "Реестр ITSM", href: "/itsm/incidents", icon: "clipboard-data" },
  { label: "Разработчикам", href: "/admin/developers", icon: "code-slash" },
] satisfies Array<{ label: string; href: string; icon: IconName }>;

export function AppShell({
  children,
  healthBadge,
  footerSlot,
  headerActions,
  titleActions,
  title = "Пульт координатора",
}: {
  children: ReactNode;
  healthBadge?: ReactNode;
  footerSlot?: ReactNode;
  headerActions?: ReactNode;
  titleActions?: ReactNode;
  title?: string | null;
}) {
  const pathname = window.location.pathname.replace(/\/$/, "") || "/admin/incidents";

  return (
    <div className={styles.shell} data-surface="canvas">
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <ProjectLink href="/admin/incidents" className={styles.brand} aria-label="МТС — пульт координатора">
            <img src={logo} alt="" className={styles.brandMark} />
          </ProjectLink>
          <nav className={styles.navigation} aria-label="Разделы проекта">
            {sections.map(({ label, href, icon }) => (
              <ProjectLink
                key={href}
                href={href}
                aria-current={pathname === href || pathname.startsWith(href + "/") ? "page" : undefined}
              >
                <Icon name={icon} size={17} />
                {label}
              </ProjectLink>
            ))}
          </nav>
          {headerActions ? <div className={styles.headerActions}>{headerActions}</div> : null}
        </div>
      </header>
      <main className={styles.workspace}>
        {title !== null || healthBadge || titleActions ? (
          <div className={styles.titleRow}>
            {title !== null ? <h1>{title}</h1> : null}
            {healthBadge || titleActions ? <div className={styles.titleActions}>{healthBadge}{titleActions}</div> : null}
          </div>
        ) : null}
        {children}
      </main>
      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          <span>goida-code · Кейс МТС</span>
          {footerSlot}
        </div>
      </footer>
    </div>
  );
}
