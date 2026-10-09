import { Exa } from "exa-js";
import type { ContentsOptions, RegularSearchOptions } from "exa-js";
import { assertProviderAvailable } from "./credentials.js";
import {
  ExaCreditsExhaustedError,
  MAX_TOTAL_RESULT_CHARS,
  SearchAbortedError,
  clampNumResults,
  isExaCreditsExhausted,
  isPositiveNumber,
  normalizeExaFetchResult,
  normalizeExaResult,
  recencyStartDate,
  rethrowMapped,
} from "./types.js";
import type {
  WebFetchRequest,
  WebFetchResponse,
  WebFetchResult,
  WebSearchCategory,
  WebSearchRequest,
  WebSearchResponse,
  WebSearchResult,
} from "./types.js";

const EXA_MAX_RESULTS = 100;
const SYSTEM_PROMPT = "Prefer official sources and avoid duplicate results.";

// Exa-js exposes no per-request timeout or abort signal; a hung endpoint
// would block the tool call forever. Race every request against this cap
// and report cancellation on abort. The HTTP call may still run and bill.
const EXA_REQUEST_TIMEOUT_MS = 60_000;

function withTimeout<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new SearchAbortedError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      reject(
        new Error(`Exa request timed out after ${EXA_REQUEST_TIMEOUT_MS}ms`),
      );
    }, EXA_REQUEST_TIMEOUT_MS);
    signal?.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

// Exa rejects startPublishedDate for these categories with a 400 error.
const NO_PUBLISHED_DATE_CATEGORIES: ReadonlySet<WebSearchCategory> = new Set([
  "company",
  "people",
]);

// Lazy singleton: Exa's quickstart reuses one client.
let exaClient: Exa | undefined;
function getExaClient(): Exa {
  if (!exaClient) {
    exaClient = new Exa(assertProviderAvailable("exa"));
  }
  return exaClient;
}

export async function searchExa(
  params: WebSearchRequest,
  options?: { signal?: AbortSignal },
): Promise<WebSearchResponse> {
  if (options?.signal?.aborted) throw new SearchAbortedError();

  const startPublishedDate = recencyStartDate(params.recencyDays);
  const { category } = params;
  const dateSupported =
    category === undefined || !NO_PUBLISHED_DATE_CATEGORIES.has(category);

  // Keep aggregate snippet output inside the shared budget: the per-URL
  // cap is the budget divided across the requested results, so
  // numResults x cap <= MAX_TOTAL_RESULT_CHARS.
  const numResults = clampNumResults(params.numResults, EXA_MAX_RESULTS);
  const perUrlCap = Math.max(
    1,
    Math.floor(MAX_TOTAL_RESULT_CHARS / numResults),
  );

  const searchOptions: RegularSearchOptions = {
    numResults,
    type: "auto",
    systemPrompt: SYSTEM_PROMPT,
    contents: {
      highlights: { maxCharacters: perUrlCap },
    },
  };
  if (category !== undefined) searchOptions.category = category;
  if (startPublishedDate !== undefined && dateSupported) {
    searchOptions.startPublishedDate = startPublishedDate;
  }

  const warnings: string[] = [];
  if (startPublishedDate !== undefined && !dateSupported) {
    warnings.push(
      `category "${category}" does not support recencyDays; the date filter was skipped`,
    );
  }

  try {
    const response = await withTimeout(
      getExaClient().search(params.query, searchOptions),
      options?.signal,
    );
    if (options?.signal?.aborted) throw new SearchAbortedError();

    const result: WebSearchResponse = {
      provider: "exa",
      query: params.query,
      results: response.results
        .map(normalizeExaResult)
        .filter((r): r is WebSearchResult => r !== null),
    };
    if (warnings.length > 0) result.warnings = warnings;
    if (response.requestId) result.requestId = response.requestId;
    return result;
  } catch (error) {
    rethrowMapped(error, options?.signal, (e) =>
      isExaCreditsExhausted(e) ? new ExaCreditsExhaustedError() : null,
    );
  }
}

export async function fetchExa(
  params: WebFetchRequest,
  options?: { signal?: AbortSignal },
): Promise<WebFetchResponse> {
  if (options?.signal?.aborted) throw new SearchAbortedError();

  // text/summary/highlights are top-level /contents options; the
  // `contents` wrapper is only for /search.
  const contents: ContentsOptions = {};
  if (params.mode === "summary") {
    // Exa summaries have no character cap; maxChars applies to fetch-mode
    // text here and to Parallel excerpts in summary mode.
    contents.summary = params.objective ? { query: params.objective } : true;
  } else {
    // maxChars bounds fetch-mode text; a 0 or negative value is a caller
    // mistake, not "unlimited".
    const maxChars = isPositiveNumber(params.maxChars)
      ? params.maxChars
      : undefined;
    contents.text = maxChars !== undefined ? { maxCharacters: maxChars } : true;
    if (params.objective) {
      // Focused excerpts alongside text; the normalizer prefers text
      // for fetch mode and falls back to highlights.
      contents.highlights = { query: params.objective };
    }
  }
  // Intentionally omitted: useAutoprompt, numSentences, highlightsPerUrl,
  // livecrawl, tokensNum, stream, maxAgeHours, subpages.

  const warnings: string[] = [];
  try {
    const response = await withTimeout(
      getExaClient().getContents(params.urls, contents),
      options?.signal,
    );
    if (options?.signal?.aborted) throw new SearchAbortedError();

    // Per-URL failures come back as HTTP 200 statuses, not request errors.
    for (const status of response.statuses ?? []) {
      if (status.status === "success") continue;
      const error = (status as { error?: unknown }).error;
      warnings.push(
        `Failed to fetch ${status.id}: ${
          typeof error === "string" ? error : status.status
        }`,
      );
    }

    const result: WebFetchResponse = {
      provider: "exa",
      mode: params.mode,
      urls: params.urls,
      results: response.results
        .map((r) => normalizeExaFetchResult(r, params.mode))
        .filter((r): r is WebFetchResult => r !== null),
    };
    if (warnings.length > 0) result.warnings = warnings;
    if (response.requestId) result.requestId = response.requestId;
    return result;
  } catch (error) {
    rethrowMapped(error, options?.signal, (e) =>
      isExaCreditsExhausted(e) ? new ExaCreditsExhaustedError() : null,
    );
  }
}
