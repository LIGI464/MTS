import * as Accordion from "@radix-ui/react-accordion";
import { Menu } from "lucide-react";
import type { ReactNode } from "react";
import { footerMenus, SHOWCASE_URL } from "./nav";
import { MenuList } from "./menu-list";
import { NavigationDialog } from "./navigation-dialog";
import styles from "./shell.module.css";

export function PortalFooter({
  openMenu,
  onOpenChange,
  footerSlot,
}: {
  openMenu: string | null;
  onOpenChange: (id: string, open: boolean) => void;
  footerSlot: ReactNode;
}) {
  return (
    <>
      <footer className={styles.footer}>
        <Accordion.Root className={styles.footerGrid} type="single" collapsible>
          {footerMenus.map((menu) => (
            <Accordion.Item className={styles.footerItem} key={menu.id} value={menu.id}>
              <Accordion.Header>
                <Accordion.Trigger className={styles.footerTrigger}>{menu.label}</Accordion.Trigger>
              </Accordion.Header>
              <Accordion.Content className={styles.footerContent}>
                <MenuList items={menu.items} />
              </Accordion.Content>
            </Accordion.Item>
          ))}
        </Accordion.Root>
        <div className={styles.footerTools}>
          <NavigationDialog
            open={openMenu === "about"}
            onOpenChange={(open) => onOpenChange("about", open)}
            title="Информация о сайте"
            description="Пульт координатора — прототип команды goida-code по кейсу МТС."
            variant="sheet"
            closeLabel="Понятно"
            trigger={
              <button type="button" className={styles.textButton}>
                Информация о сайте
              </button>
            }
          >
            <p className={styles.note}>
              Это демонстрационный стенд команды, а не промышленный раздел оператора. Навигация повторяет роли
              публичной витрины.
            </p>
            <a className={styles.link} href={SHOWCASE_URL} target="_blank" rel="noopener noreferrer">
              Ростовская витрина
            </a>
          </NavigationDialog>
        </div>
        <div className={styles.slot}>{footerSlot}</div>
      </footer>
      <NavigationDialog
        open={openMenu === "mobile-sections"}
        onOpenChange={(open) => onOpenChange("mobile-sections", open)}
        title="Разделы"
        description="Нижние разделы портала."
        variant="sheet"
        trigger={
          <button type="button" className={styles.mobileToggle}>
            <Menu size={18} aria-hidden />
            <span>Разделы</span>
          </button>
        }
      >
        <div className={styles.mobileGroups}>
          {footerMenus.map((menu) => (
            <section key={menu.id} aria-label={menu.label}>
              <h2 className={styles.mobileHeading}>{menu.label}</h2>
              <MenuList items={menu.items} />
            </section>
          ))}
        </div>
      </NavigationDialog>
    </>
  );
}
