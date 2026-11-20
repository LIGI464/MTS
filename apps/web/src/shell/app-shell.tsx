import type { ReactNode } from "react";

export function AppShell({
  children,
  healthBadge,
  footerSlot,
}: {
  children: ReactNode;
  healthBadge: ReactNode;
  footerSlot: ReactNode;
}) {
  return (
    <div className="app-shell">
      <header className="app-header">
        <p className="brand">goida-code · Кейс МТС</p>
        <div>{healthBadge}</div>
      </header>
      <main className="workspace">{children}</main>
      <footer className="app-footer">
        <nav className="footer-links" aria-label="Нижняя навигация">
          <span>Связь и дом</span>
          <span>Сервисы</span>
          <span>Поддержка</span>
          <span>Документы</span>
          <span>О проекте</span>
        </nav>
        {footerSlot}
      </footer>
    </div>
  );
}
