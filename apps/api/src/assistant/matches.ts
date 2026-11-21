import type { TicketSummary } from "@mts/contracts";

export const MAX_MATCH_TEXT_LENGTH = 4_000;
const MAX_QUERY_LENGTH = 1_000;
const MAX_MATCHES = 5;
const MAX_ACTIVE_SIMILAR = 5;

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

export type ActiveSimilarIncident = Pick<ArchiveMatchTicket, "id" | "version" | "title" | "present"> & {
  state: TicketSummary["state"];
  symptom: string | null;
  reason: string;
  href: string;
};

export type ComparisonCoverage = {
  uniqueAvailable: number;
  uniqueExamined: number;
  complete: boolean;
};

export type SimilarIncidentsQuery = { incidentId?: string; symptoms?: string };

export type SimilarIncidentsResult =
  | { kind: "found"; matches: readonly SimilarIncident[]; coverage: ComparisonCoverage; activeSimilar: readonly ActiveSimilarIncident[] }
  | { kind: "no_matches"; coverage: ComparisonCoverage; activeSimilar: readonly ActiveSimilarIncident[] }
  | { kind: "needs_context" | "incident_not_found" };

type Archive = {
  getSearchTicket(id: string): ArchiveMatchTicket | null;
  allSearchTickets(): Iterable<ArchiveMatchTicket>;
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
  "сбой сбоя сбои сбои сбоев похожие сходные завершенные решенные прошлые другие архив карточка итсм найди найти покажи " +
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

type RankedCandidate = {
  score: number;
  reason: string;
  candidate: ArchiveMatchTicket;
};

function compareRanked(left: RankedCandidate, right: RankedCandidate): number {
  return right.score - left.score ||
    (right.candidate.resolvedAt ?? "").localeCompare(left.candidate.resolvedAt ?? "") ||
    (left.candidate.id < right.candidate.id ? -1 : Number(left.candidate.id > right.candidate.id));
}

function isCompleted(state: ArchiveMatchTicket["state"]): state is "Resolved" | "Closed" {
  return state === "Resolved" || state === "Closed";
}

function scoreCandidate(
  subject: ArchiveMatchTicket | null,
  candidate: ArchiveMatchTicket,
  cues: ReadonlySet<string>,
): RankedCandidate | null {
  const subjectWords = subject ? symptomTokens(subject, tokens(subject.product, subject.service)) : new Set<string>();
  const product = normalize(subject?.product ?? null);
  const service = normalize(subject?.service ?? null);
  const category = tokens(candidate.product, candidate.service);
  const words = symptomTokens(candidate, category);
  const shared = overlap(subjectWords, words);
  const sharedCues = overlap(cues, words);
  const sameProduct = product !== "" && normalize(candidate.product) === product;
  const sameService = service !== "" && normalize(candidate.service) === service;
  const symptomCueCount = cues.size - overlap(cues, category);
  const enoughCues = sharedCues >= 2 || (sharedCues === 1 && symptomCueCount === 1);
  const enoughContext = shared >= 2 || (shared >= 1 && (sameProduct || sameService));
  if (!enoughContext && !enoughCues) return null;

  const fields = [sameProduct && "продукт", sameService && "сервис", "признаки сбоя"].filter(Boolean);
  return {
    score: 3 * shared + 5 * sharedCues + 3 * Number(sameProduct) + 2 * Number(sameService),
    reason: `Совпадают ${fields.join(", ")}.`,
    candidate,
  };
}

function buildSimilarMatch(
  candidate: ArchiveMatchTicket & { state: "Resolved" | "Closed" },
  reason: string,
  resolveItsmUrl: (ticket: ArchiveMatchTicket) => string | null,
): SimilarIncident {
  const { id, version, title, state, resolvedAt, present } = candidate;
  return {
    id, version, state, resolvedAt, present,
    title: boundedText(title, 220) ?? id,
    symptom: boundedText(candidate.shortDescription, 320) ?? boundedText(candidate.description, 320),
    solution: boundedText(candidate.solution, 600),
    reason,
    href: resolveItsmUrl(candidate) ?? `/itsm/incidents/${encodeURIComponent(id)}`,
  };
}

function buildActiveMatch(
  candidate: ArchiveMatchTicket,
  reason: string,
  resolveItsmUrl: (ticket: ArchiveMatchTicket) => string | null,
): ActiveSimilarIncident {
  const { id, version, title, state, present } = candidate;
  return {
    id, version, state, present,
    title: boundedText(title, 220) ?? id,
    symptom: boundedText(candidate.shortDescription, 320) ?? boundedText(candidate.description, 320),
    reason,
    href: resolveItsmUrl(candidate) ?? `/itsm/incidents/${encodeURIComponent(id)}`,
  };
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

  const ranked: RankedCandidate[] = [];
  let uniqueAvailable = 0;
  let uniqueExamined = 0;

  for (const candidate of archive.allSearchTickets()) {
    if (candidate.id === incidentId) continue;
    uniqueAvailable += 1;
    uniqueExamined += 1;
    const scored = scoreCandidate(subject, candidate, cues);
    if (!scored) continue;
    ranked.push(scored);
  }

  ranked.sort(compareRanked);

  const coverage: ComparisonCoverage = {
    uniqueAvailable,
    uniqueExamined,
    complete: true,
  };

  const matches: SimilarIncident[] = [];
  const activeSimilar: ActiveSimilarIncident[] = [];

  for (const entry of ranked) {
    if (isCompleted(entry.candidate.state)) {
      if (matches.length < MAX_MATCHES) {
        matches.push(buildSimilarMatch(
          entry.candidate as ArchiveMatchTicket & { state: "Resolved" | "Closed" },
          entry.reason,
          resolveItsmUrl,
        ));
      }
    } else if (activeSimilar.length < MAX_ACTIVE_SIMILAR) {
      activeSimilar.push(buildActiveMatch(entry.candidate, entry.reason, resolveItsmUrl));
    }
    if (matches.length >= MAX_MATCHES && activeSimilar.length >= MAX_ACTIVE_SIMILAR) break;
  }

  if (matches.length > 0) {
    return { kind: "found", matches, coverage, activeSimilar };
  }
  return { kind: "no_matches", coverage, activeSimilar };
}