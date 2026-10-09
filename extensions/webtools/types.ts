import { ExaError } from "exa-js";

export type WebSearchCategory =
  | "company"
  | "publication"
  | "news"
  | "personal site"
  | "financial report"
  | "people";

export type WebSearchRequest = {
  query: string;
  numResults?: number;
  recencyDays?: number;
  category?: WebSearchCategory;
};

export type WebSearchResult = {
  url: string;
  title: string | null;
  snippet: string;
  publishedDate: string | null;
  score?: number;
};

export type WebFetchMode = "fetch" | "summary";

export type WebFetchRequest = {
  urls: string[];
  mode: WebFetchMode;
  objective?: string;
  maxChars?: number;
};

export type WebFetchResult = {
  url: string;
  title: string | null;
  content: string;
  publishedDate?: string;
};

export type WebFetchResponse = {
  provider: "exa" | "parallel";
  mode: WebFetchMode;
  urls: string[];
  results: WebFetchResult[];
  warnings?: string[];
  requestId?: string;
};

export type WebSearchResponse = {
  provider: "exa" | "parallel";
  query: string;
  results: WebSearchResult[];
  requestId?: string;
  warnings?: string[];
};

export class SearchAbortedError extends Error {}

export class ExaCreditsExhaustedError extends Error {}

// Shared budget: cap total snippet/excerpt characters returned to the
// model per call. Parallel enforces it server-side; Exa scales its
// per-URL highlight cap to stay inside it.
export const MAX_TOTAL_RESULT_CHARS = 20_000;

export function isPositiveNumber(n: number | undefined): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}

export function warningMessages(
  warnings: ReadonlyArray<{ message: unknown }> | null | undefined,
): string[] {
  if (!warnings) return [];
  return warnings
    .map((w) => w.message)
    .filter((m): m is string => typeof m === "string");
}

export function rethrowMapped(
  error: unknown,
  signal: AbortSignal | undefined,
  mapCredits: (error: unknown) => Error | null,
): never {
  if (signal?.aborted) throw new SearchAbortedError();
  const creditsError = mapCredits(error);
  if (creditsError) throw creditsError;
  throw error;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}


export function isExaCreditsExhausted(error: unknown): boolean {
  return error instanceof ExaError && error.statusCode === 402;
}

export function clampNumResults(
  n: number | undefined,
  max: number = 100,
): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return 10;
  return Math.min(max, Math.max(1, Math.round(n)));
}

const MAX_KEYWORD_QUERIES = 3;
const KEYWORDS_PER_QUERY = 6;
const MAX_KEYWORD_QUERY_CHARS = 200;

// Parallel wants keyword queries (3-6 words, no sentences), not the full
// natural-language query.
const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "nor", "yet", "so", "for",
  "of", "in", "on", "at", "to", "from", "with", "without", "by",
  "about", "as", "into", "over", "under", "between", "during",
  "before", "after", "up", "down", "out", "off", "across",
  "i", "me", "my", "we", "our", "us", "you", "your", "he", "him",
  "his", "she", "her", "it", "its", "they", "them", "their",
  "this", "that", "these", "those", "who", "whom", "whose",
  "what", "which", "when", "where", "why", "how",
  "is", "are", "was", "were", "be", "been", "being", "am",
  "do", "does", "did", "have", "has", "had", "can", "could",
  "should", "would", "will", "shall", "may", "might", "must",
  "not", "no", "also", "very", "just", "get", "got", "know",
  "want", "need", "tell", "find", "search", "information", "info",
  "please",
]);

export function deriveKeywordQueries(query: string): string[] {
  const words = query
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .split(/\s+/)
    .filter((w) => w !== "" && !STOPWORDS.has(w.toLowerCase()));

  if (words.length === 0) {
    const fallback = query.trim();
    return [
      fallback.length > MAX_KEYWORD_QUERY_CHARS
        ? fallback.slice(0, MAX_KEYWORD_QUERY_CHARS)
        : fallback,
    ];
  }

  const queries: string[] = [];
  for (
    let i = 0;
    i < words.length && queries.length < MAX_KEYWORD_QUERIES;
    i += KEYWORDS_PER_QUERY
  ) {
    queries.push(words.slice(i, i + KEYWORDS_PER_QUERY).join(" "));
  }

  // Merge a trailing 1-2 word query into the previous one.
  if (queries.length > 1) {
    const last = queries[queries.length - 1];
    if (last.split(" ").length < 3) {
      queries[queries.length - 2] =
        `${queries[queries.length - 2]} ${last}`.trim();
      queries.pop();
    }
  }
  return queries;
}

export function recencyStartDate(
  recencyDays: number | undefined,
): string | undefined {
  if (
    typeof recencyDays !== "number" ||
    !Number.isFinite(recencyDays) ||
    recencyDays <= 0
  ) {
    return undefined;
  }
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - recencyDays);
  return d.toISOString().slice(0, 10);
}

export function normalizeExaResult(result: unknown): WebSearchResult | null {
  const r = asRecord(result);
  const url = typeof r.url === "string" ? r.url : "";
  if (!url) return null;

  const out: WebSearchResult = {
    url,
    title: typeof r.title === "string" ? r.title : null,
    snippet: (Array.isArray(r.highlights) ? r.highlights : []).join("\n\n"),
    publishedDate: typeof r.publishedDate === "string" ? r.publishedDate : null,
  };
  if (typeof r.score === "number") out.score = r.score;
  return out;
}

export function normalizeParallelResult(
  result: unknown,
): WebSearchResult | null {
  const r = asRecord(result);
  const url = typeof r.url === "string" ? r.url : "";
  if (!url) return null;

  return {
    url,
    title: typeof r.title === "string" ? r.title : null,
    snippet: (Array.isArray(r.excerpts) ? r.excerpts : []).join("\n\n"),
    publishedDate: typeof r.publish_date === "string" ? r.publish_date : null,
  };
}

export function normalizeExaFetchResult(
  result: unknown,
  mode: WebFetchMode,
): WebFetchResult | null {
  return normalizeFetchResult(result, mode, EXA_FETCH_FIELDS);
}

export function normalizeParallelFetchResult(
  result: unknown,
  mode: WebFetchMode,
): WebFetchResult | null {
  return normalizeFetchResult(result, mode, PARALLEL_FETCH_FIELDS);
}

type FetchFieldMap = {
  text: string;
  excerpts: string;
  summary: string;
  publishedDate: string;
};

// Exa and Parallel return the same shape under different field names.
const EXA_FETCH_FIELDS: FetchFieldMap = {
  text: "text",
  excerpts: "highlights",
  summary: "summary",
  publishedDate: "publishedDate",
};

const PARALLEL_FETCH_FIELDS: FetchFieldMap = {
  text: "full_content",
  excerpts: "excerpts",
  summary: "excerpts",
  publishedDate: "publish_date",
};

function joinStrings(value: unknown): string {
  return (Array.isArray(value) ? value : [])
    .filter((item): item is string => typeof item === "string")
    .join("\n\n");
}

function normalizeFetchResult(
  result: unknown,
  mode: WebFetchMode,
  fields: FetchFieldMap,
): WebFetchResult | null {
  const r = asRecord(result);
  const url = typeof r.url === "string" ? r.url : "";
  if (!url) return null;

  // Content: `text` in fetch mode, `summary` in summary mode. Parallel
  // Extract has no LLM summary; joined excerpts are its summary. Excerpts
  // also double as the fallback when primary content is missing.
  let content: string;
  if (mode === "summary") {
    const summary = r[fields.summary];
    content =
      typeof summary === "string" ? summary : joinStrings(r[fields.excerpts]);
  } else {
    const text = r[fields.text];
    content = typeof text === "string" ? text : "";
    if (content.trim() === "") content = joinStrings(r[fields.excerpts]);
  }
  if (content.trim() === "") return null;

  const out: WebFetchResult = {
    url,
    title: typeof r.title === "string" ? r.title : null,
    content,
  };
  const date = r[fields.publishedDate];
  if (typeof date === "string" && date !== "") {
    out.publishedDate = date;
  }
  return out;
}

function fallbackTitle(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export function formatSearchResults(response: WebSearchResponse): string {
  const header = `Web search results (provider: ${response.provider}, ${response.results.length} results)`;

  if (response.results.length === 0) {
    return `${header}\n\nNo results found.`;
  }

  const blocks = response.results.map((r, i) => {
    const title =
      r.title && r.title.trim() !== "" ? r.title : fallbackTitle(r.url);
    const lines = [`${i + 1}. **${title}** — ${r.url}`];
    if (r.publishedDate) {
      lines.push(`   Published: ${r.publishedDate.slice(0, 10)}`);
    }
    const snippet = r.snippet.trim();
    if (snippet !== "") lines.push(`  > ${snippet}`);
    return lines.join("\n");
  });

  const warnings =
    response.warnings && response.warnings.length > 0
      ? `\n\nWarnings:\n${response.warnings.map((w) => `- ${w}`).join("\n")}`
      : "";
  return `${header}\n\n${blocks.join("\n\n")}${warnings}`;
}

export function formatFetchResults(response: WebFetchResponse): string {
  const header = `Web fetch results (provider: ${response.provider}, mode: ${response.mode}, ${response.results.length} results)`;

  if (response.results.length === 0) {
    return `${header}\n\nNo content fetched.`;
  }

  const blocks = response.results.map((r) => {
    const title =
      r.title && r.title.trim() !== "" ? r.title : fallbackTitle(r.url);
    const lines = [`## ${title}`, r.url];
    if (r.publishedDate) {
      lines.push(`Published: ${r.publishedDate.slice(0, 10)}`);
    }
    lines.push("", r.content, "---");
    return lines.join("\n");
  });

  const warnings =
    response.warnings && response.warnings.length > 0
      ? `\n\nWarnings:\n${response.warnings.map((w) => `- ${w}`).join("\n")}`
      : "";
  return `${header}\n\n${blocks.join("\n\n")}${warnings}`;
}
