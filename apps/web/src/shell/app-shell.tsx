import type { ReactNode } from "react";
import { Activity, ClipboardList, FlaskConical, LayoutDashboard } from "lucide-react";
import styles from "./shell.module.css";

const sections = [
  { label: "Пульт", href: "/admin/incidents", icon: LayoutDashboard },
  { label: "Реестр ITSM", href: "/itsm/incidents", icon: ClipboardList },
  { label: "Разработчикам", href: "/admin/developers", icon: FlaskConical },
];

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
  title?: string;
}) {
  const pathname = window.location.pathname.replace(/\/$/, "") || "/admin/incidents";

  return (
    <div className={styles.shell} data-surface="canvas">
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <a href="/admin/incidents" className={styles.brand} aria-label="Кейс МТС — пульт координатора">
            <span className={styles.brandMark}><Activity size={23} aria-hidden /></span>
            <span>Кейс МТС</span>
          </a>
          <nav className={styles.navigation} aria-label="Разделы проекта">
            {sections.map(({ label, href, icon: Icon }) => (
              <a
                key={href}
                href={href}
                aria-current={pathname === href || pathname.startsWith(href + "/") ? "page" : undefined}
              >
                <Icon size={17} aria-hidden />
                {label}
              </a>
            ))}
          </nav>
          {headerActions ? <div className={styles.headerActions}>{headerActions}</div> : null}
        </div>
      </header>
      <main className={styles.workspace}>
        <div className={styles.titleRow}>
          <h1>{title}</h1>
          <div className={styles.titleActions}>
            {healthBadge}
            {titleActions}
          </div>
        </div>
        {children}
      </main>
      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          <span>goida-code · Кейс МТС</span>
          {footerSlot ? <div className={styles.service}>{footerSlot}</div> : null}
        </div>
      </footer>
    </div>
  );
}
