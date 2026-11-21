import type { TicketSummary } from "@mts/contracts";

export const MAX_MATCH_TEXT_LENGTH = 4_000;
const MAX_QUERY_LENGTH = 1_000;
const MAX_MATCHES = 5;

export type ArchiveMatchTicket = Pick<TicketSummary,
  "id" | "version" | "title" | "state" | "resolvedAt" | "present" | "product" | "service"
> & {
  shortDescription: string | null;
  description: string | null;
  solution: string | null;
  sysId: string | null;
};

export type SimilarIncident = Pick<ArchiveMatchTicket, "id" | "version" | "title" | "resolvedAt" | "present"> & {
  state: "Resolved" | "Closed";
  symptom: string | null;
  solution: string | null;
  reason: string;
  href: string;
};

export type SimilarIncidentsQuery = { incidentId?: string; symptoms?: string };

export type SimilarIncidentsResult =
  | { kind: "found"; matches: readonly SimilarIncident[] }
  | { kind: "no_matches" | "needs_context" | "incident_not_found" };

type Archive = {
  getSearchTicket(id: string): ArchiveMatchTicket | null;
  completedSearchTickets(): Iterable<ArchiveMatchTicket>;
};

function normalize(value: string | null): string {
  return (value?.normalize("NFKC").toLocaleLowerCase("ru").replaceAll("ё", "е").match(/[\p{L}\p{N}]+/gu) ?? []).join(" ");
}

function stem(word: string): string {
  if (!/^[а-я]{5,}$/u.test(word)) return word;
  const base = word.replace(/(?:иями|ями|ами|ого|ему|ому|ыми|ими|ов|ев|ам|ям|ах|ях|ий|ый|ая|ое|ие|ые|ой|ую|ых|их|ом|ем|е|а|и|у|ы|я|ю|о|ь)$/u, "");
  return base.length < 4 ? word : base;
}

const generic = new Set(normalize(
  "для при или как что это тот такая там после где есть был была было уже надо можно нужно почему чтобы " +
  "инцидент инцидента инциденту инциденты инцидентов заявка заявки заявок проблема проблемы ошибка ошибки " +
  "сбой сбоя сбои сбоев похожие сходные завершенные решенные прошлые другие архив карточка итсм найди найти покажи " +
  "подбери поиск аналог аналоги аналогов ранее оператор сервис продукт данные номер номеру работает работают",
).split(" ").map(stem));

function tokens(...parts: (string | null)[]): Set<string> {
  return new Set(parts.flatMap((value) => normalize(value).replace(/\b(https?) ([1-5]\d{2})\b/gu, "$1$2").split(" "))
    .filter((word) => word.length >= 3 && /\p{L}/u.test(word))
    .map(stem)
    .filter((word) => !generic.has(word)));
}

function symptomTokens(ticket: ArchiveMatchTicket, category: ReadonlySet<string>): Set<string> {
  const words = tokens(ticket.title === ticket.id ? null : ticket.title, ticket.shortDescription, ticket.description);
  for (const word of category) words.delete(word);
  return words;
}

function overlap(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
  let matches = 0;
  for (const word of left) if (right.has(word)) matches += 1;
  return matches;
}

function boundedText(value: string | null, max: number): string | null {
  const text = value?.replace(/[\p{Cc}\s]+/gu, " ").trim();
  if (!text) return null;
  if (text.length <= max) return text;
  return text.slice(0, max - 1).replace(/[\uD800-\uDBFF]$/u, "").trimEnd() + "…";
}

type RankedMatch = { score: number; match: SimilarIncident };

function compareMatches(left: RankedMatch, right: RankedMatch): number {
  return right.score - left.score ||
    (right.match.resolvedAt ?? "").localeCompare(left.match.resolvedAt ?? "") ||
    (left.match.id < right.match.id ? -1 : Number(left.match.id > right.match.id));
}

export function findSimilarIncidents(
  archive: Archive,
  { incidentId, symptoms }: SimilarIncidentsQuery,
  resolveItsmUrl: (ticket: ArchiveMatchTicket) => string | null,
): SimilarIncidentsResult {
  const subject = incidentId === undefined ? null : archive.getSearchTicket(incidentId);
  if (incidentId !== undefined && !subject) return { kind: "incident_not_found" };

  const cues = tokens(symptoms?.slice(0, MAX_QUERY_LENGTH) ?? null);
  if (!subject && cues.size === 0) return { kind: "needs_context" };

  const subjectWords = subject ? symptomTokens(subject, tokens(subject.product, subject.service)) : new Set<string>();
  const product = normalize(subject?.product ?? null);
  const service = normalize(subject?.service ?? null);
  const ranked: RankedMatch[] = [];

  for (const candidate of archive.completedSearchTickets()) {
    if (candidate.id === incidentId || (candidate.state !== "Resolved" && candidate.state !== "Closed")) continue;
    const category = tokens(candidate.product, candidate.service);
    const words = symptomTokens(candidate, category);
    const shared = overlap(subjectWords, words);
    const sharedCues = overlap(cues, words);
    const sameProduct = product !== "" && normalize(candidate.product) === product;
    const sameService = service !== "" && normalize(candidate.service) === service;
    const symptomCueCount = cues.size - overlap(cues, category);
    const enoughCues = sharedCues >= 2 || (sharedCues === 1 && symptomCueCount === 1);
    const enoughContext = shared >= 2 || (shared >= 1 && (sameProduct || sameService));
    if (!enoughContext && !enoughCues) continue;

    const fields = [sameProduct && "продукт", sameService && "сервис", "признаки сбоя"].filter(Boolean);
    const { id, version, title, state, resolvedAt, present } = candidate;
    ranked.push({
      score: 3 * shared + 5 * sharedCues + 3 * Number(sameProduct) + 2 * Number(sameService),
      match: {
        id, version, state, resolvedAt, present,
        title: boundedText(title, 220) ?? id,
        symptom: boundedText(candidate.shortDescription, 320) ?? boundedText(candidate.description, 320),
        solution: boundedText(candidate.solution, 600),
        reason: `Совпадают ${fields.join(", ")}.`,
        href: resolveItsmUrl(candidate) ?? `/itsm/incidents/${encodeURIComponent(id)}`,
      },
    });
    ranked.sort(compareMatches);
    if (ranked.length > MAX_MATCHES) ranked.pop();
  }

  return ranked.length > 0 ? { kind: "found", matches: ranked.map(({ match }) => match) } : { kind: "no_matches" };
}
