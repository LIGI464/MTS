/** Адрес «В ITSM» общий для карточки и панели. productUrl переход не задаёт. */
export function itsmHref(incident: { id: string; itsmUrl: string | null }): string {
  const given = incident.itsmUrl?.trim() ?? "";
  if (isExternalItsm(given)) return given;
  return `/itsm/incidents/${encodeURIComponent(incident.id)}`;
}

function isExternalItsm(value: string): boolean {
  if (value.length === 0) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.username.length === 0 && url.password.length === 0;
  } catch {
    return false;
  }
}
