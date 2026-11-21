import type { NavLink } from "./nav";
import styles from "./shell.module.css";

function isExternal(href: string): boolean {
  return /^https?:/i.test(href);
}

export function MenuList({ items }: { items: NavLink[] }) {
  return (
    <ul className={styles.list}>
      {items.map((item) => (
        <li key={item.label}>
          {item.href ? (
            <a
              className={styles.link}
              href={item.href}
              {...(isExternal(item.href) ? { target: "_blank", rel: "noopener noreferrer" } : {})}
            >
              {item.label}
            </a>
          ) : (
            <span className={styles.demoItem}>
              <span>{item.label}</span>
              <span className={styles.demoMark}>Демо</span>
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
