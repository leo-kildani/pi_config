import type {
  AgentToolResult,
  AgentToolUpdateCallback,
  ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { StringEnum, type JsonValue } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { assertProviderAvailable, setProviderApiKey } from "./credentials.js";
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
          {
            type: "text",
            text: "Exa credits exhausted; falling back to Parallel…",
          },
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
          "Exa credits are exhausted and Parallel is not configured. Top up Exa at https://dashboard.exa.ai or add the parallel key to ~/.pi/agent/extensions/webtools/env.json.",
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
      "Search the web for current facts, recent events, references, or answers beyond your training data. Use this tool when the operator asks for a search or you need current information. Do not use it to fetch page content.",
    promptSnippet: "Search the web for current facts and recent information",
    promptGuidelines: [
      "Use `web_search` when you do not know the answer, your information may be old, or the operator asks for a search.",
      "Build targeted queries with specific entities, dates, or concepts.",
      "Do not fetch full result pages unless the operator asks you to fetch those URLs.",
      "Answer from the result snippets and metadata.",
    ],
    parameters: Type.Object({
      query: Type.String({
        description:
          "Search query. Include entities, dates, and the fact you need.",
      }),
      numResults: Type.Optional(
        Type.Number({
          description: "Maximum results. Default: 10. Maximum: 100.",
        }),
      ),
      recencyDays: Type.Optional(
        Type.Number({
          description:
            "Prefer pages from this many recent days. Omit to skip the date filter.",
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
              "Filter by content type. company and people do not support recencyDays, so web_search skips that filter for them.",
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
        ...(params.category !== undefined ? { category: params.category } : {}),
      };

      return await runWithFallback<WebSearchRequest, WebSearchResponse>({
        request,
        exa: searchExa,
        parallel: searchParallel,
        format: formatSearchResults,
        progress: "Search Exa…",
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
      "Fetch or summarize specific URLs that the operator provides or asks you to read. Do not use this tool to inspect search results automatically.",
    promptSnippet: "Fetch or summarize specific URLs from the operator",
    promptGuidelines: [
      "Use `web_fetch` only when the operator provides a URL, points to a link, or asks you to read page content.",
      "Do not call `web_fetch` after `web_search` unless the operator asks you to fetch those result pages.",
      'Set `mode` to `"summary"` and provide an `objective` for targeted extraction.',
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
            'Mode. "fetch" returns page text. "summary" returns a short summary.',
        }),
      ),
      objective: Type.Optional(
        Type.String({
          description:
            "Content to extract or summarize. Omit to return the full page.",
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
        progress: "Fetch with Exa…",
        signal,
        modelId: ctx.model?.id,
        onUpdate,
      });
    },
  });

  pi.registerCommand("webtools", {
    description: "Configure an Exa or Parallel API key",
    getArgumentCompletions: (prefix) =>
      "config".startsWith(prefix.trim().toLowerCase())
        ? [{ value: "config", label: "config" }]
        : null,
    handler: async (args, ctx) => {
      if (args.trim() !== "config") {
        ctx.ui.notify("Usage: /webtools config", "warning");
        return;
      }
      if (!ctx.hasUI) {
        ctx.ui.notify("Webtools configuration requires an interactive UI.", "warning");
        return;
      }

      const providerName = await ctx.ui.select("Webtools provider", ["Exa", "Parallel"]);
      if (!providerName) return;
      const provider = providerName === "Exa"
        ? "exa"
        : providerName === "Parallel"
          ? "parallel"
          : undefined;
      if (!provider) return;

      const apiKey = await ctx.ui.input(`${providerName} API key`, "Enter API key");
      if (apiKey === undefined) return;
      const trimmedKey = apiKey.trim();
      if (!trimmedKey) {
        ctx.ui.notify("API key cannot be empty.", "warning");
        return;
      }

      try {
        setProviderApiKey(provider, trimmedKey);
        ctx.ui.notify(`Saved ${providerName} API key to env.json.`, "info");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`Could not save API key: ${message}`, "error");
      }
    },
  });
}
