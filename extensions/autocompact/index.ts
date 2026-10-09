/**
 * autocompact extension.
 *
 * At each new prompt (`before_agent_start`) it reads context usage. At the
 * recommended band it asks whether the current objective differs from recent work.
 * At the high-water limit it compacts without a classifier judgment. The summary is built by
 * pi-vcc, which hooks `session_before_compact` and handles the `manual` reason.
 *
 * The extension never passes `customInstructions`, so pi-vcc keeps full
 * control of the cut and the smart-keep tail.
 */

import { SettingsManager, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { loadSettings, scaffoldSettings } from "./config.ts";
import {
	buildJudgmentContext,
	buildState,
	decide,
	recallGuideline,
	type CompactJudgment,
	type CompactUsage,
} from "./decide.ts";
import { logEvent } from "./log.ts";

const JUDGMENT_TIMEOUT_MS = 10_000;
const FALLBACK_KEEP_RECENT_TOKENS = 20_000;
const MAX_USER_MESSAGES = 10;
const CLASSIFIER_PROVIDER = "typesafe";
const CLASSIFIER_MODEL_ID = "jev-latest";

/** Extract plain text from an agent message content value. */
function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.map((part) => {
				if (part && typeof part === "object" && (part as { type?: string }).type === "text") {
					return (part as { text?: string }).text ?? "";
				}
				return "";
			})
			.join("\n")
			.trim();
	}
	return "";
}

function contextUsage(ctx: ExtensionContext): CompactUsage {
	return { tokens: ctx.getContextUsage()?.tokens ?? null };
}

function keepRecentTokens(ctx: ExtensionContext): number {
	try {
		return SettingsManager.create(ctx.cwd).getCompactionKeepRecentTokens(ctx.model);
	} catch {
		return FALLBACK_KEEP_RECENT_TOKENS;
	}
}

export default function (pi: ExtensionAPI): void {
	scaffoldSettings();

	let userMessages: string[] = [];
	let lastAssistantText = "";
	let lastToolNames: string[] = [];
	let lastSummary = "";
	let pendingCompaction = false;
	let turnsSinceCompaction = Number.POSITIVE_INFINITY;
	let lastTier: string = "silent";

	/** Ask the classifier judgment. Returns null on any failure or timeout. */
	async function judge(
		ctx: ExtensionContext,
		state: ReturnType<typeof buildState>,
	): Promise<CompactJudgment | null> {
		const model = ctx.modelRegistry.findOfType(
			"classifier",
			CLASSIFIER_PROVIDER,
			CLASSIFIER_MODEL_ID,
		);
		if (!model) return null;

		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), JUDGMENT_TIMEOUT_MS);
		const forwardAbort = () => controller.abort();
		ctx.signal?.addEventListener("abort", forwardAbort, { once: true });
		try {
			const result = await ctx.modelRegistry.classify(model, buildJudgmentContext(state), {
				signal: controller.signal,
			});
			if (result.stopReason !== "stop") return null;
			const read = (key: string): number | null => {
				const answer = result.answers[key];
				return answer?.type === "bool" && typeof answer.probability === "number"
					? answer.probability
					: null;
			};
			const values = {
				objective_shift: read("objective_shift"),
				at_boundary: read("at_boundary"),
				mid_operation: read("mid_operation"),
				needs_history: read("needs_history"),
			};
			if (Object.values(values).some((value) => value === null)) return null;
			return values as CompactJudgment;
		} catch {
			return null;
		} finally {
			clearTimeout(timer);
			ctx.signal?.removeEventListener("abort", forwardAbort);
		}
	}

	/** Trigger compaction and wait for it. Never rejects. */
	function runCompaction(ctx: ExtensionContext): Promise<void> {
		pendingCompaction = true;
		return new Promise<void>((resolve) => {
			const done = (): void => {
				pendingCompaction = false;
				resolve();
			};
			try {
				ctx.compact({
					onComplete: () => {
						logEvent("compact_done");
						done();
					},
					onError: () => {
						logEvent("compact_error");
						done();
					},
				});
			} catch {
				logEvent("compact_error");
				done();
			}
		});
	}

	function notifyTier(ctx: ExtensionContext, tier: string, reason: string): void {
		if (tier === lastTier) return;
		lastTier = tier;
		if (tier === "silent" || !ctx.hasUI) return;
		ctx.ui.notify(`autocompact: ${tier} (${reason})`, "info");
		logEvent("notice", { tier, reason });
	}

	pi.on("message_end", (event) => {
		const message = event.message as { role?: string; content?: unknown };
		if (message?.role === "user") {
			userMessages.push(textOf(message.content));
			if (userMessages.length > MAX_USER_MESSAGES) {
				userMessages = userMessages.slice(-MAX_USER_MESSAGES);
			}
		} else if (message?.role === "assistant") {
			const text = textOf(message.content);
			if (text) lastAssistantText = text;
		}
	});

	pi.on("turn_end", (event) => {
		turnsSinceCompaction += 1;
		lastToolNames = (event.toolResults ?? [])
			.map((result) => (result as { toolName?: string }).toolName ?? "")
			.filter(Boolean);
	});

	pi.on("session_start", (_event, ctx) => {
		userMessages = [];
		lastAssistantText = "";
		lastSummary = "";
		lastToolNames = [];
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type === "message") {
				const message = entry.message as { role?: string; content?: unknown };
				if (message.role === "user") userMessages.push(textOf(message.content));
				else if (message.role === "assistant") {
					const text = textOf(message.content);
					if (text) lastAssistantText = text;
				}
			} else if (entry.type === "compaction" && entry.summary) {
				lastSummary = entry.summary;
			}
		}
		if (userMessages.length > MAX_USER_MESSAGES) {
			userMessages = userMessages.slice(-MAX_USER_MESSAGES);
		}
		turnsSinceCompaction = Number.POSITIVE_INFINITY;
		pendingCompaction = false;
		lastTier = "silent";
	});

	pi.on("session_compact", (event) => {
		if (event.compactionEntry?.summary) lastSummary = event.compactionEntry.summary;
		userMessages = [];
		pendingCompaction = false;
		turnsSinceCompaction = 0;
		lastTier = "silent";
	});

	pi.on("session_compact_failed", () => {
		pendingCompaction = false;
	});

	pi.on("before_agent_start", async (event, ctx) => {
		const config = loadSettings();
		if (!config.enabled) return;

		const usage = contextUsage(ctx);
		if (usage.tokens == null) return;

		const keepRecent = keepRecentTokens(ctx);
		const state = buildState({
			prompt: event.prompt,
			userMessages,
			lastAssistantText,
			lastSummary,
			toolNames: lastToolNames,
			usage,
			keepRecentTokens: keepRecent,
		});

		const onCooldown = turnsSinceCompaction < config.cooldownTurns;
		const atRecommended = usage.tokens >= config.recommendedTokens;
		const belowHighWater = usage.tokens < config.highWaterTokens;
		const shouldJudge =
			atRecommended &&
			belowHighWater &&
			!pendingCompaction &&
			!onCooldown &&
			usage.tokens > keepRecent &&
			userMessages.length >= 1;
		const judgment = shouldJudge ? await judge(ctx, state) : null;
		if (shouldJudge) logEvent("judgment", { ok: judgment != null, state, answers: judgment });

		const decision = decide({
			usage,
			judgment,
			config,
			keepRecentTokens: keepRecent,
			onCooldown,
			compactionPending: pendingCompaction,
		});

		logEvent("decision", {
			tokens: usage.tokens,
			keepRecentTokens: keepRecent,
			noticeTokens: config.noticeTokens,
			recommendedTokens: config.recommendedTokens,
			highWaterTokens: config.highWaterTokens,
			pendingCompaction,
			turnsSinceCompaction,
			onCooldown,
			judged: judgment != null,
			judgment,
			tier: decision.tier,
			action: decision.action,
			reason: decision.reason,
		});

		notifyTier(ctx, decision.tier, decision.reason);

		if (decision.action === "compact") {
			logEvent("compact", { tier: decision.tier, reason: decision.reason });
			await runCompaction(ctx);
			const guideline = recallGuideline(lastSummary);
			if (guideline) {
				event.systemPromptOptions.promptGuidelines = [
					...(event.systemPromptOptions.promptGuidelines ?? []),
					guideline,
				];
			}
		}
	});
}
