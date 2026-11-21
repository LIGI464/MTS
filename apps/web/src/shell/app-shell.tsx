import { useState, type ReactNode } from "react";
import { PortalFooter } from "./portal-footer";
import { PortalHeader } from "./portal-header";
import styles from "./shell.module.css";

export function AppShell({
  children,
  healthBadge,
  footerSlot,
}: {
  children: ReactNode;
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
    <div className={styles.shell}>
      <PortalHeader openMenu={openMenu} onOpenChange={onOpenChange} />
      <main className={styles.workspace}>
        <div className={styles.titleRow}>
          <h1 className={styles.title}>Пульт координатора</h1>
          <div className={styles.health}>{healthBadge}</div>
        </div>
        {children}
      </main>
      <PortalFooter openMenu={openMenu} onOpenChange={onOpenChange} footerSlot={footerSlot} />
    </div>
  );
}
