import { useState, type ReactNode } from "react";
import { PortalFooter } from "./portal-footer";
import { PortalHeader } from "./portal-header";
import styles from "./shell.module.css";

export function AppShell({
  children,
  title,
  healthBadge,
  footerSlot,
}: {
  children: ReactNode;
  title: string;
  healthBadge: ReactNode;
  footerSlot: ReactNode;
}) {
  const [openMenu, setOpenMenu] = useState<string | null>(null);

  function onOpenChange(id: string, next: boolean) {
    setOpenMenu((current) => {
      if (next) return id;
      return current === id ? null : current;
    });
  }

  return (
    <div className={styles.shell} data-surface="canvas">
      <PortalHeader openMenu={openMenu} onOpenChange={onOpenChange} />
      <main className={styles.workspace}>
        <div className={styles.titleRow}>
          <h1 className={styles.title}>{title}</h1>
          <div className={styles.health}>
            {healthBadge}
            <a className={styles.link} href="/itsm/incidents">
              Реестр ITSM
            </a>
          </div>
        </div>
        {children}
      </main>
      <PortalFooter openMenu={openMenu} onOpenChange={onOpenChange} footerSlot={footerSlot} />
    </div>
  );
}
