import type {
  AgentToolResult,
  AgentToolUpdateCallback,
  ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { StringEnum, type JsonValue } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { assertProviderAvailable } from "./credentials.js";
import { fetchExa, searchExa } from "./exa.js";
import { fetchParallel, searchParallel } from "./parallel.js";
import {
  ExaCreditsExhaustedError,
  SearchAbortedError,
  formatFetchResults,
  formatSearchResults,
} from "./types.js";
import type {
  WebFetchRequest,
  WebFetchResponse,
  WebSearchRequest,
  WebSearchResponse,
} from "./types.js";

const WebSearchOutput = Type.Object({
  provider: StringEnum(["exa", "parallel"]),
  query: Type.String(),
  results: Type.Array(
    Type.Object({
      url: Type.String(),
      title: Type.Union([Type.String(), Type.Null()]),
      snippet: Type.String(),
      publishedDate: Type.Union([Type.String(), Type.Null()]),
      score: Type.Optional(Type.Number()),
    }),
  ),
  requestId: Type.Optional(Type.String()),
  warnings: Type.Optional(Type.Array(Type.String())),
});

const WebFetchOutput = Type.Object({
  provider: StringEnum(["exa", "parallel"]),
  mode: StringEnum(["fetch", "summary"]),
  urls: Type.Array(Type.String()),
  results: Type.Array(
    Type.Object({
      url: Type.String(),
      title: Type.Union([Type.String(), Type.Null()]),
      content: Type.String(),
      publishedDate: Type.Optional(Type.String()),
    }),
  ),
  warnings: Type.Optional(Type.Array(Type.String())),
  requestId: Type.Optional(Type.String()),
});

async function runWithFallback<TRequest, TResponse extends JsonValue>(options: {
  request: TRequest;
  exa: (
    request: TRequest,
    options: { signal?: AbortSignal },
  ) => Promise<TResponse>;
  parallel: (
    request: TRequest,
    options: { signal?: AbortSignal; modelId?: string },
  ) => Promise<TResponse>;
  format: (response: TResponse) => string;
  progress: string;
  signal?: AbortSignal;
  modelId?: string;
  onUpdate?: AgentToolUpdateCallback<TResponse>;
}): Promise<AgentToolResult<TResponse>> {
  try {
    options.onUpdate?.({
      content: [{ type: "text", text: options.progress }],
      details: {} as TResponse,
    });

    assertProviderAvailable("exa");

    let response: TResponse;
    try {
      response = await options.exa(options.request, {
        signal: options.signal,
      });
    } catch (error) {
      if (!(error instanceof ExaCreditsExhaustedError)) throw error;

      options.onUpdate?.({
        content: [
          { type: "text", text: "Exa credits exhausted; falling back to Parallel…" },
        ],
        details: {} as TResponse,
      });

      // The bare "key is not set" error hides the root cause: Exa
      // credits ran out. Name both facts in one message.
      let parallelKey: string | undefined;
      try {
        parallelKey = assertProviderAvailable("parallel");
      } catch {
        // handled below
      }
      if (!parallelKey) {
        throw new Error(
          "Exa credits are exhausted and the Parallel fallback is not configured (PARALLEL_API_KEY is not set). Top up Exa at https://dashboard.exa.ai or add PARALLEL_API_KEY to ~/.pi/agent/extensions/webtools/.env.",
        );
      }

      response = await options.parallel(options.request, {
        signal: options.signal,
        modelId: options.modelId,
      });
    }

    return {
      content: [{ type: "text", text: options.format(response) }],
      details: response,
      structuredContent: response,
    };
  } catch (error) {
    if (error instanceof SearchAbortedError) {
      return {
        content: [{ type: "text", text: "Cancelled" }],
        details: {} as TResponse,
      };
    }
    throw error;
  }
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "web_search",
    label: "Web Search",
    description:
      "Search the web to find facts, recent developments, references, or answers to questions outside your training data. Use this tool when the operator asks to search for something or when you need up-to-date information. Do not use this tool to fetch raw or full-page content.",
    promptSnippet:
      "Search the web for answers, recent information, and quick facts",
    promptGuidelines: [
      "Use `web_search` when you lack concrete answers to the operator's prompt, when data may be stale, or when the operator explicitly asks you to search.",
      "Formulate targeted queries containing specific entities, dates, or concepts.",
      "Do not attempt or plan to retrieve the full contents of the search result links unless the operator explicitly directs you to fetch those specific URLs.",
      "Answer directly from the search snippets and metadata provided in the response.",
    ],
    parameters: Type.Object({
      query: Type.String({
        description:
          "Natural-language search query. Include entities, dates, and the specific fact you need.",
      }),
      numResults: Type.Optional(
        Type.Number({
          description:
            "Maximum number of results to return. Defaults to 10, maximum 100.",
        }),
      ),
      recencyDays: Type.Optional(
        Type.Number({
          description:
            "Prefer pages published within this many days. Omit for no recency filter.",
        }),
      ),
      category: Type.Optional(
        Type.Enum(
          {
            news: "news",
            company: "company",
            people: "people",
            publication: "publication",
            "personal site": "personal site",
            "financial report": "financial report",
          } as const,
          {
            description:
              "Content type to focus on. company and people do not support recencyDays; the date filter is skipped for them.",
          },
        ),
      ),
    }),
    outputSchema: WebSearchOutput,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const query = params.query.trim();
      if (!query) {
        throw new Error("query is required");
      }

      const request: WebSearchRequest = {
        query,
        ...(params.numResults !== undefined
          ? { numResults: params.numResults }
          : {}),
        ...(params.recencyDays !== undefined
          ? { recencyDays: params.recencyDays }
          : {}),
        ...(params.category !== undefined
          ? { category: params.category }
          : {}),
      };

      return await runWithFallback<WebSearchRequest, WebSearchResponse>({
        request,
        exa: searchExa,
        parallel: searchParallel,
        format: formatSearchResults,
        progress: "Searching with Exa…",
        signal,
        modelId: ctx.model?.id,
        onUpdate,
      });
    },
  });

  pi.registerTool({
    name: "web_fetch",
    label: "Web Fetch",
    description:
      "Fetch or summarize the content of specific URLs provided directly by the operator or explicitly requested for retrieval. Do not call this automatically to inspect search results.",
    promptSnippet:
      "Read or summarize content from specific URLs provided by the operator",
    promptGuidelines: [
      "Use `web_fetch` ONLY when the operator explicitly provides a URL, points to a specific link to inspect, or directly asks you to read/scrape page contents.",
      "Never chain `web_fetch` immediately after `web_search` unless the operator explicitly instructed you to fetch or read those specific result pages.",
      'Set `mode` to `"summary"` and provide an `objective` when the user needs targeted extraction rather than the raw page text.',
    ],
    parameters: Type.Object({
      urls: Type.Array(Type.String(), {
        minItems: 1,
        maxItems: 20,
        description: "URLs to fetch. Up to 20.",
      }),
      mode: Type.Optional(
        StringEnum(["fetch", "summary"], {
          default: "fetch",
          description:
            'Fetch mode. "fetch" returns full page text; "summary" returns a condensed synthesis.',
        }),
      ),
      objective: Type.Optional(
        Type.String({
          description:
            "What to extract or summarize from the pages. Omit for whole-page content.",
        }),
      ),
      maxChars: Type.Optional(
        Type.Number({
          description: "Cap on characters returned per page.",
          minimum: 1,
        }),
      ),
    }),
    outputSchema: WebFetchOutput,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      // The provider fetchers only handle web pages. Validate URLs up
      // front so garbage or non-http(s) input fails with a clear message
      // instead of reaching the providers.
      const urls: string[] = [];
      const invalid: string[] = [];
      for (const raw of params.urls) {
        const url = raw.trim();
        if (url === "") continue;
        let parsed: URL;
        try {
          parsed = new URL(url);
        } catch {
          invalid.push(url);
          continue;
        }
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          invalid.push(url);
          continue;
        }
        urls.push(url);
      }
      if (invalid.length > 0) {
        throw new Error(
          `Invalid URLs: ${invalid.join(", ")}. Only http:// and https:// are supported.`,
        );
      }
      if (urls.length === 0) {
        throw new Error("urls is required");
      }

      const request: WebFetchRequest = {
        urls,
        // StringEnum's Static resolves to `string`; the schema guarantees
        // the union, so cast to the request type.
        mode: (params.mode ?? "fetch") as WebFetchRequest["mode"],
        ...(params.objective !== undefined
          ? { objective: params.objective }
          : {}),
        ...(params.maxChars !== undefined ? { maxChars: params.maxChars } : {}),
      };

      return await runWithFallback<WebFetchRequest, WebFetchResponse>({
        request,
        exa: fetchExa,
        parallel: fetchParallel,
        format: formatFetchResults,
        progress: "Fetching with Exa…",
        signal,
        modelId: ctx.model?.id,
        onUpdate,
      });
    },
  });
}
