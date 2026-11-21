import * as Dialog from "@radix-ui/react-dialog";
import { ListChecks } from "lucide-react";
import styles from "./shell.module.css";

export function EventsButton({ count }: { count: number }) {
  return (
    <Dialog.Trigger className={styles.eventsButton} aria-label={count ? `События, новых: ${count}` : "События"}>
      <ListChecks size={17} aria-hidden />
      События
      {count > 0 ? <span data-numeric="tabular" aria-hidden>{count}</span> : null}
    </Dialog.Trigger>
  );
}
