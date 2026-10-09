import assert from "node:assert";
import {
  ExaCreditsExhaustedError,
  SearchAbortedError,
  clampNumResults,
  deriveKeywordQueries,
  formatFetchResults,
  formatSearchResults,
  normalizeExaFetchResult,
  normalizeExaResult,
  normalizeParallelFetchResult,
  normalizeParallelResult,
  recencyStartDate,
  rethrowMapped,
} from "./types.ts";
import type {
  WebFetchResponse,
  WebSearchResponse,
} from "./types.ts";

assert.strictEqual(clampNumResults(undefined), 10);
assert.strictEqual(clampNumResults(5), 5);
assert.strictEqual(clampNumResults(50), 50);
assert.strictEqual(clampNumResults(500), 100);
assert.strictEqual(clampNumResults(0), 1);
assert.strictEqual(clampNumResults(-3), 1);
assert.strictEqual(clampNumResults(Number.NaN), 10);
assert.strictEqual(clampNumResults(50, 20), 20);
assert.strictEqual(clampNumResults(5, 20), 5);

assert.deepStrictEqual(
  deriveKeywordQueries(
    "What are the latest AI safety regulations in the European Union and how do they affect open source model development?",
  ),
  [
    "latest AI safety regulations European Union",
    "affect open source model development",
  ],
);
assert.deepStrictEqual(
  deriveKeywordQueries("Best budget hotels in Tokyo with free wifi"),
  ["Best budget hotels Tokyo free wifi"],
);
assert.deepStrictEqual(deriveKeywordQueries("climate"), ["climate"]);
assert.deepStrictEqual(deriveKeywordQueries("what is it?"), ["what is it?"]);
// 13 content words -> chunks of 6+6+1, trailing chunk merged.
const longQuery = [
  "alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta",
  "iota", "kappa", "lambda", "mu", "nu",
].join(" ");
assert.deepStrictEqual(deriveKeywordQueries(longQuery), [
  "alpha beta gamma delta epsilon zeta",
  "eta theta iota kappa lambda mu nu",
]);
// No sentence punctuation leaks into queries.
for (const q of deriveKeywordQueries("Pinecone, pgvector & Weaviate — benchmarks?")) {
  assert.ok(!/[?!.,]/.test(q), `punctuation leaked: ${q}`);
}
assert.ok(
  deriveKeywordQueries(longQuery).every((q) => q.length <= 200),
  "query exceeds 200 chars",
);

// --- web_fetch normalizers and formatter (no network) ---

// Exa fetch mode: text wins.
const exaFetch = normalizeExaFetchResult(
  {
    url: "https://example.com/a",
    title: "Page A",
    text: "full text",
    publishedDate: "2024-01-15",
  },
  "fetch",
);
assert.ok(exaFetch);
assert.strictEqual(exaFetch.content, "full text");
assert.strictEqual(exaFetch.publishedDate, "2024-01-15");

// Exa fetch mode falls back to highlights when text is empty.
const exaHighlight = normalizeExaFetchResult(
  { url: "https://example.com/b", highlights: ["focused excerpt"] },
  "fetch",
);
assert.ok(exaHighlight);
assert.strictEqual(exaHighlight.content, "focused excerpt");

// Exa summary mode prefers summary.
const exaSummary = normalizeExaFetchResult(
  { url: "https://example.com/c", summary: "condensed", text: "full" },
  "summary",
);
assert.ok(exaSummary);
assert.strictEqual(exaSummary.content, "condensed");

// Drop results with no url or no usable content.
assert.strictEqual(normalizeExaFetchResult({ title: "no url" }, "fetch"), null);
assert.strictEqual(
  normalizeExaFetchResult({ url: "https://example.com/x" }, "fetch"),
  null,
);
assert.strictEqual(
  normalizeExaFetchResult({ url: "https://example.com/y", summary: "" }, "summary"),
  null,
);

// Parallel fetch mode: full_content.
const parFetch = normalizeParallelFetchResult(
  {
    url: "https://example.com/a",
    title: "Page A",
    full_content: "full text",
    publish_date: "2024-02-01",
  },
  "fetch",
);
assert.ok(parFetch);
assert.strictEqual(parFetch.content, "full text");
assert.strictEqual(parFetch.publishedDate, "2024-02-01");

// Parallel summary mode: joined excerpts; publishedDate omitted.
const parSummary = normalizeParallelFetchResult(
  { url: "https://example.com/b", excerpts: ["excerpt one", "excerpt two"] },
  "summary",
);
assert.ok(parSummary);
assert.strictEqual(parSummary.content, "excerpt one\n\nexcerpt two");
assert.ok(!("publishedDate" in parSummary), "publishedDate not omitted");

assert.strictEqual(
  normalizeParallelFetchResult({ url: "https://example.com/n" }, "fetch"),
  null,
);

const fetchResponse: WebFetchResponse = {
  provider: "exa",
  mode: "fetch",
  urls: ["https://example.com/a", "https://example.com/c"],
  results: [
    {
      url: "https://example.com/a",
      title: "Page A",
      content: "Body of A.",
      publishedDate: "2024-01-15T00:00:00Z",
    },
    { url: "https://example.com/c", title: null, content: "Body of C." },
  ],
  warnings: ["Failed to fetch https://example.com/b: failure"],
  requestId: "req_123",
};
const fmt = formatFetchResults(fetchResponse);
assert.ok(
  fmt.startsWith("Web fetch results (provider: exa, mode: fetch, 2 results)"),
  fmt,
);
assert.ok(fmt.includes("## Page A"), fmt);
assert.ok(fmt.includes("https://example.com/a"), fmt);
assert.ok(fmt.includes("Published: 2024-01-15"), fmt);
assert.ok(fmt.includes("Body of A."), fmt);
// No title -> hostname heading.
assert.ok(fmt.includes("## example.com"), fmt);
assert.ok(fmt.includes("---"), fmt);
assert.ok(fmt.includes("Warnings:\n- Failed to fetch https://example.com/b: failure"), fmt);

const emptyFmt = formatFetchResults({
  provider: "parallel",
  mode: "summary",
  urls: ["https://example.com/a"],
  results: [],
});
assert.ok(emptyFmt.includes("No content fetched."), emptyFmt);

// Exa summary mode falls back to joined highlights when summary is missing.
const exaSummaryFallback = normalizeExaFetchResult(
  { url: "https://example.com/e", highlights: ["h1", "h2"] },
  "summary",
);
assert.strictEqual(exaSummaryFallback?.content, "h1\n\nh2");

// Parallel fetch mode falls back to excerpts when full_content is missing.
const parFetchFallback = normalizeParallelFetchResult(
  { url: "https://example.com/d", excerpts: ["excerpt"] },
  "fetch",
);
assert.strictEqual(parFetchFallback?.content, "excerpt");

// --- recencyStartDate (UTC date math) ---

assert.strictEqual(recencyStartDate(undefined), undefined);
assert.strictEqual(recencyStartDate(0), undefined);
assert.strictEqual(recencyStartDate(-5), undefined);
assert.strictEqual(recencyStartDate(Number.NaN), undefined);
assert.strictEqual(recencyStartDate(Number.POSITIVE_INFINITY), undefined);
const yesterday = new Date();
yesterday.setUTCDate(yesterday.getUTCDate() - 1);
assert.strictEqual(
  recencyStartDate(1),
  yesterday.toISOString().slice(0, 10),
);

// --- search result normalizers ---

assert.strictEqual(normalizeExaResult(null), null);
assert.strictEqual(normalizeExaResult({ title: "no url" }), null);
const exaResult = normalizeExaResult({
  url: "https://example.com/x",
  title: "Title",
  highlights: ["h1", "h2"],
  publishedDate: "2024-03-01T00:00:00Z",
  score: 0.9,
});
assert.ok(exaResult);
assert.strictEqual(exaResult.url, "https://example.com/x");
assert.strictEqual(exaResult.title, "Title");
assert.strictEqual(exaResult.snippet, "h1\n\nh2");
assert.strictEqual(exaResult.publishedDate, "2024-03-01T00:00:00Z");
assert.strictEqual(exaResult.score, 0.9);
const noHighlightExa = normalizeExaResult({
  url: "https://example.com/y",
  highlights: "not array",
});
assert.ok(noHighlightExa);
assert.strictEqual(noHighlightExa.snippet, "");

assert.strictEqual(normalizeParallelResult(null), null);
assert.strictEqual(normalizeParallelResult({ title: "no url" }), null);
const parResult = normalizeParallelResult({
  url: "https://example.com/p",
  title: "P Title",
  excerpts: ["e1", "e2"],
  publish_date: "2024-04-01T00:00:00Z",
});
assert.ok(parResult);
assert.strictEqual(parResult.snippet, "e1\n\ne2");
assert.strictEqual(parResult.publishedDate, "2024-04-01T00:00:00Z");
assert.ok(!("score" in parResult), "parallel result carries no score");

// --- formatSearchResults ---

const searchResponse: WebSearchResponse = {
  provider: "exa",
  query: "test",
  results: [
    {
      url: "https://example.com/s1",
      title: "Result One",
      snippet: "Snippet one.",
      publishedDate: null,
    },
    {
      url: "https://example.com/s2",
      title: "",
      snippet: "   ",
      publishedDate: "2024-05-01T00:00:00Z",
    },
  ],
  warnings: ["warning here"],
  requestId: "req_x",
};
const searchFmt = formatSearchResults(searchResponse);
assert.ok(
  searchFmt.startsWith("Web search results (provider: exa, 2 results)"),
  searchFmt,
);
assert.ok(
  searchFmt.includes("1. **Result One** — https://example.com/s1"),
  searchFmt,
);
assert.ok(searchFmt.includes("> Snippet one."), searchFmt);
// Blank title falls back to the hostname; empty snippet line omitted.
assert.ok(
  searchFmt.includes(
    "2. **example.com** — https://example.com/s2\n   Published: 2024-05-01",
  ),
  searchFmt,
);
assert.ok(searchFmt.includes("Warnings:\n- warning here"), searchFmt);

const emptySearchFmt = formatSearchResults({
  provider: "parallel",
  query: "x",
  results: [],
});
assert.ok(emptySearchFmt.includes("No results found."), emptySearchFmt);

// --- rethrowMapped (shared abort/credits mapping) ---

const aborted = new AbortController();
aborted.abort();
assert.throws(
  () => rethrowMapped(new Error("x"), aborted.signal, () => null),
  SearchAbortedError,
);
const credits = new ExaCreditsExhaustedError();
assert.throws(
  () => rethrowMapped(new Error("x"), undefined, () => credits),
  ExaCreditsExhaustedError,
);
assert.throws(
  () => rethrowMapped(new Error("original"), undefined, () => null),
  /original/,
);

console.log("all checks ok");
