import type { MutationResult, TicketDetail, TicketSummary } from "@mts/contracts";

export function filterTickets(items: readonly TicketSummary[], search: string): readonly TicketSummary[] {
  const term = search.trim().toLocaleLowerCase("ru-RU");
  if (!term) return items;
  return items.filter(({ id, title, product }) =>
    [id, title, product].some((value) => value?.toLocaleLowerCase("ru-RU").includes(term)),
  );
}

export function confirmsResolution(detail: TicketDetail, receipt: MutationResult, solution: string): boolean {
  return detail.ticket.id === receipt.id && detail.ticket.state === "Resolved"
    && detail.history.some((entry) => entry.version === receipt.version && entry.present && entry.solution === solution);
}
