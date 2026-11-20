import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import styles from "./shell.module.css";

export function NavigationDialog({
  open,
  onOpenChange,
  title,
  description,
  trigger,
  children,
  variant = "panel",
  closeLabel = "Закрыть",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  trigger: ReactNode;
  children: ReactNode;
  variant?: "panel" | "sheet";
  closeLabel?: string;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content className={variant === "sheet" ? styles.sheet : styles.panel}>
          <div className={styles.panelHead}>
            <Dialog.Title className={styles.panelTitle}>{title}</Dialog.Title>
            <Dialog.Close className={styles.close}>
              <X size={16} aria-hidden />
              <span>{closeLabel}</span>
            </Dialog.Close>
          </div>
          <Dialog.Description className={styles.description}>{description}</Dialog.Description>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
