import { ChevronDown, MapPin } from "lucide-react";
import { audienceMenus, brandLabel, catalogMenus, regionMenu, SHOWCASE_URL } from "./nav";
import { MenuList } from "./menu-list";
import { NavigationDialog } from "./navigation-dialog";
import styles from "./shell.module.css";

export function PortalHeader({
  openMenu,
  onOpenChange,
}: {
  openMenu: string | null;
  onOpenChange: (id: string, open: boolean) => void;
}) {
  return (
    <header className={styles.portal}>
      <div className={styles.row}>
        <p className={styles.brand}>{brandLabel}</p>
        <nav className={styles.cluster} aria-label="Аудитории">
          {audienceMenus.map((menu) => (
            <NavigationDialog
              key={menu.id}
              open={openMenu === menu.id}
              onOpenChange={(open) => onOpenChange(menu.id, open)}
              title={menu.label}
              description={menu.description}
              trigger={
                <button type="button" className={styles.trigger}>
                  <span>{menu.label}</span>
                  <ChevronDown size={16} aria-hidden />
                </button>
              }
            >
              <MenuList items={menu.items} />
            </NavigationDialog>
          ))}
        </nav>
        <div className={styles.actions}>
          <NavigationDialog
            open={openMenu === regionMenu.id}
            onOpenChange={(open) => onOpenChange(regionMenu.id, open)}
            title={regionMenu.label}
            description={regionMenu.description}
            trigger={
              <button type="button" className={styles.trigger}>
                <MapPin size={16} aria-hidden />
                <span>{regionMenu.label}</span>
              </button>
            }
          >
            <MenuList items={regionMenu.items} />
          </NavigationDialog>
          <NavigationDialog
            open={openMenu === "payment"}
            onOpenChange={(open) => onOpenChange("payment", open)}
            title="Оплата"
            description="Оплата в прототипе не выполняется. Можно открыть публичную витрину."
            trigger={
              <button type="button" className={styles.trigger}>
                Оплата
              </button>
            }
          >
            <p className={styles.note}>Внутренней формы оплаты нет.</p>
            <a className={styles.link} href={SHOWCASE_URL} target="_blank" rel="noopener noreferrer">
              Публичная витрина
            </a>
          </NavigationDialog>
          <NavigationDialog
            open={openMenu === "login"}
            onOpenChange={(open) => onOpenChange("login", open)}
            title="Вход"
            description="Вход в прототипе не выполняется. Можно открыть публичную витрину."
            trigger={
              <button type="button" className={styles.trigger}>
                Вход
              </button>
            }
          >
            <p className={styles.note}>Внутренней формы входа нет.</p>
            <a className={styles.link} href={SHOWCASE_URL} target="_blank" rel="noopener noreferrer">
              Публичная витрина
            </a>
          </NavigationDialog>
        </div>
      </div>
      <nav className={`${styles.row} ${styles.catalog}`} aria-label="Разделы портала">
        {catalogMenus.map((menu) => (
          <NavigationDialog
            key={menu.id}
            open={openMenu === menu.id}
            onOpenChange={(open) => onOpenChange(menu.id, open)}
            title={menu.label}
            description={menu.description}
            trigger={
              <button type="button" className={styles.trigger}>
                <span>{menu.label}</span>
                <ChevronDown size={16} aria-hidden />
              </button>
            }
          >
            <MenuList items={menu.items} />
          </NavigationDialog>
        ))}
      </nav>
    </header>
  );
}
