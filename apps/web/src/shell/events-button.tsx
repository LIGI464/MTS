import * as Dialog from "@radix-ui/react-dialog";
import { Icon } from "../icons";
import styles from "./shell.module.css";

export function EventsButton({ count }: { count: number }) {
  return (
    <Dialog.Trigger className={styles.eventsButton} aria-label={count ? `События, новых: ${count}` : "События"}>
      <Icon name="list-ul" size={17} />
      События
      {count > 0 ? <span data-numeric="tabular" aria-hidden>{count}</span> : null}
    </Dialog.Trigger>
  );
}
