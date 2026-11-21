import type { Coordinator } from "@mts/contracts";
import styles from "./board.module.css";

export function CoordinatorValue({ coordinator }: { coordinator: Coordinator | null }) {
  if (!coordinator) return "Координатор не указан в ITSM";
  return <><strong>{coordinator.name}</strong>{" "}<span className={styles.sourceTag}>ITSM</span></>;
}
