const DICTIONARY_UTC = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;
const ISO_WITH_ZONE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?)(Z|[+-]\d{2}:\d{2})$/;

export function normalizeUtcInstant(value: string): string | null {
  const dictionary = DICTIONARY_UTC.exec(value);
  if (dictionary) {
    const iso = `${dictionary[1]}-${dictionary[2]}-${dictionary[3]}T${dictionary[4]}:${dictionary[5]}:${dictionary[6]}.000Z`;
    const parsed = Date.parse(iso);
    if (Number.isNaN(parsed)) return null;
    return new Date(parsed).toISOString() === iso ? iso : null;
  }

  if (!ISO_WITH_ZONE.test(value)) return null;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toISOString();
}
