import Parallel from "parallel-web";
import { assertProviderAvailable } from "./credentials.js";
import {
  MAX_TOTAL_RESULT_CHARS,
  SearchAbortedError,
  clampNumResults,
  deriveKeywordQueries,
  isPositiveNumber,
  normalizeParallelFetchResult,
  normalizeParallelResult,
  recencyStartDate,
  rethrowMapped,
  warningMessages,
} from "./types.js";
import type {
  WebFetchRequest,
  WebFetchResponse,
  WebFetchResult,
  WebSearchRequest,
  WebSearchResponse,
  WebSearchResult,
} from "./types.js";

// Parallel public modes cap max_results at 20; higher values are reduced
// with an input validation warning.
const PARALLEL_MAX_RESULTS = 20;

const CREDITS_EXHAUSTED_MESSAGE =
  "Both providers are out of credits. Top up Exa (https://dashboard.exa.ai) and/or Parallel (https://platform.parallel.ai).";

function apiStatus(error: unknown): unknown {
  return error instanceof Parallel.APIError
    ? error.status
    : (error as { status?: unknown })?.status;
}

// Lazy singleton: reuse one client, no default retries.
let parallelClient: Parallel | undefined;
function getParallelClient(): Parallel {
  if (!parallelClient) {
    parallelClient = new Parallel({
      apiKey: assertProviderAvailable("parallel"),
      maxRetries: 0,
    });
  }
  return parallelClient;
}

export async function searchParallel(
  params: WebSearchRequest,
  options?: { signal?: AbortSignal; modelId?: string },
): Promise<WebSearchResponse> {
  if (options?.signal?.aborted) throw new SearchAbortedError();

  const afterDate = recencyStartDate(params.recencyDays);
  const advancedSettings: Parallel.AdvancedSearchSettings = {
    max_results: clampNumResults(params.numResults, PARALLEL_MAX_RESULTS),
  };
  if (afterDate !== undefined) {
    advancedSettings.source_policy = { after_date: afterDate };
  }

  const body: Parallel.SearchParams = {
    objective: params.query,
    // Parallel wants 1-3 keyword queries (3-6 words, no sentences), not the
    // full natural-language query.
    search_queries: deriveKeywordQueries(params.query),
    // advanced: documented default, better retrieval/compression.
    // fast: ~700ms lower latency. Tradeoff chosen here.
    mode: "advanced",
    max_chars_total: MAX_TOTAL_RESULT_CHARS,
    advanced_settings: advancedSettings,
  };
  if (options?.modelId) body.client_model = options.modelId;

  try {
    const response = await getParallelClient().search(body, {
      signal: options?.signal,
    });
    if (options?.signal?.aborted) throw new SearchAbortedError();

    const result: WebSearchResponse = {
      provider: "parallel",
      query: params.query,
      results: response.results
        .map(normalizeParallelResult)
        .filter((r): r is WebSearchResult => r !== null),
    };
    if (response.search_id) result.requestId = response.search_id;

    const warnings = warningMessages(response.warnings);
    if (warnings.length > 0) result.warnings = warnings;

    return result;
  } catch (error) {
    rethrowMapped(error, options?.signal, (e) =>
      apiStatus(e) === 402 ? new Error(CREDITS_EXHAUSTED_MESSAGE) : null,
    );
  }
}

export async function fetchParallel(
  params: WebFetchRequest,
  options?: { signal?: AbortSignal; modelId?: string },
): Promise<WebFetchResponse> {
  if (options?.signal?.aborted) throw new SearchAbortedError();

  const body: Parallel.ExtractParams = { urls: params.urls };
  if (params.objective) body.objective = params.objective;

  if (params.mode === "fetch") {
    // maxChars bounds full content per result; a 0 or negative value is
    // a caller mistake, not "unlimited".
    const maxChars = isPositiveNumber(params.maxChars)
      ? params.maxChars
      : undefined;
    body.advanced_settings = {
      full_content: maxChars !== undefined
        ? { max_chars_per_result: maxChars }
        : true,
    };
  } else {
    // Parallel Extract has no LLM summary; focused excerpts are the v1
    // "summary". An objective (plus keyword queries) focuses the excerpts.
    if (params.objective) {
      body.search_queries = deriveKeywordQueries(params.objective);
    }
    // Excerpts only. The API default is full_content: false; set it
    // explicitly to bound cost. maxChars caps the excerpts.
    const maxChars = isPositiveNumber(params.maxChars)
      ? params.maxChars
      : undefined;
    body.advanced_settings = {
      full_content: false,
      ...(maxChars !== undefined
        ? { excerpt_settings: { max_chars_per_result: maxChars } }
        : {}),
    };
  }
  // No session_id for v1: each call is standalone.
  if (options?.modelId) body.client_model = options.modelId;

  try {
    const response = await getParallelClient().extract(body, {
      signal: options?.signal,
    });
    if (options?.signal?.aborted) throw new SearchAbortedError();

    // Per-URL failures come back in errors[], not as request errors.
    const warnings: string[] = response.errors.map((err) => {
      const http =
        typeof err.http_status_code === "number"
          ? ` (HTTP ${err.http_status_code})`
          : "";
      return `Failed to fetch ${err.url}: ${err.error_type}${http}`;
    });
    const apiWarnings = warningMessages(response.warnings);
    if (apiWarnings.length > 0) warnings.push(...apiWarnings);

    const result: WebFetchResponse = {
      provider: "parallel",
      mode: params.mode,
      urls: params.urls,
      results: response.results
        .map((r) => normalizeParallelFetchResult(r, params.mode))
        .filter((r): r is WebFetchResult => r !== null),
    };
    if (warnings.length > 0) result.warnings = warnings;
    if (response.extract_id) result.requestId = response.extract_id;
    return result;
  } catch (error) {
    rethrowMapped(error, options?.signal, (e) =>
      apiStatus(e) === 402 ? new Error(CREDITS_EXHAUSTED_MESSAGE) : null,
    );
  }
}
