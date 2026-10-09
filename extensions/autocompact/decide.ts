/**
 * Pure decision logic for the autocompact extension.
 *
 * No pi imports and no IO. `decide` maps token bands plus a classifier judgment
 * to a tier and an action. `buildState` and `buildJudgmentContext` prepare the
 * judgment payload.
 */

import type { ClassifierBoolQuestion, ClassifierContext } from "@earendil-works/pi-ai";
import type { AutocompactSettings } from "./config.ts";

export type CompactConfig = AutocompactSettings;

export interface CompactUsage {
	tokens: number | null;
}

/** Probabilities from the four classifier `bool` answers. */
export interface CompactJudgment {
	objective_shift: number;
	at_boundary: number;
	mid_operation: number;
	needs_history: number;
}

export type CompactTier = "silent" | "notice" | "recommend" | "request";
export type CompactAction = "none" | "compact";

export interface CompactDecision {
	tier: CompactTier;
	action: CompactAction;
	reason: string;
}

export interface DecideInput {
	usage: CompactUsage;
	judgment: CompactJudgment | null;
	config: CompactConfig;
	keepRecentTokens: number;
	onCooldown: boolean;
	compactionPending: boolean;
}

export interface CompactState {
	current_request: string;
	previous_work: string;
	recent_turn: string;
	tools_this_turn: string;
	context: {
		tokens: number | null;
		keepRecentTokens: number;
	};
}

export interface BuildStateInput {
	prompt: string;
	userMessages: readonly string[];
	lastAssistantText: string;
	lastSummary: string;
	toolNames: readonly string[];
	usage: CompactUsage;
	keepRecentTokens: number;
}

const CLIP_REQUEST = 600;
const CLIP_PREVIOUS_MESSAGE = 200;
const CLIP_SUMMARY = 400;
const CLIP_RECENT_TURN = 600;
const CLIP_TOOLS = 200;
const MAX_PREVIOUS_MESSAGES = 5;

function clip(text: string, limit: number): string {
	if (text.length <= limit) return text;
	return `${text.slice(0, limit - 1)}…`;
}

/** Build the compact state passed to the classifier judgment. */
export function buildState(input: BuildStateInput): CompactState {
	const parts = input.userMessages
		.slice(-MAX_PREVIOUS_MESSAGES)
		.map((message) => clip(message, CLIP_PREVIOUS_MESSAGE));
	if (input.lastSummary) parts.push(`Summary so far: ${clip(input.lastSummary, CLIP_SUMMARY)}`);

	return {
		current_request: clip(input.prompt, CLIP_REQUEST),
		previous_work: parts.join("\n") || "(nothing before this request)",
		recent_turn: clip(input.lastAssistantText, CLIP_RECENT_TURN),
		tools_this_turn: clip(input.toolNames.join(", "), CLIP_TOOLS),
		context: {
			tokens: input.usage.tokens,
			keepRecentTokens: input.keepRecentTokens,
		},
	};
}

function bool(instructions: string, yes: string, no: string): ClassifierBoolQuestion {
	return { type: "bool", instructions, criteria: { true: yes, false: no } };
}

/** Build the classifier context for the compaction judgment. */
export function buildJudgmentContext(state: CompactState): ClassifierContext {
	return {
		// CompactState is a plain JSON object; ClassifierContext.state is a JsonObject.
		state: state as unknown as ClassifierContext["state"],
		questions: {
			objective_shift: bool(
				"Does the current request have a different concrete objective from the recent work, even if it remains within the same project or domain?",
				"the request has a new concrete goal",
				"the request continues or extends the same goal",
			),
			at_boundary: bool(
				"Has the prior objective reached a natural point where the conversation can be summarized without interrupting an unfinished step?",
				"the prior objective has reached a natural stopping point",
				"the prior objective is still in an unfinished step",
			),
			mid_operation: bool(
				"Does the current request continue an unfinished multi-step operation from the recent turn, so the earlier context is still required?",
				"an unfinished operation is still in progress",
				"no unfinished operation is pending",
			),
			needs_history: bool(
				"Does answering the current request need most of the full transcript, beyond what a compaction summary and recall can provide?",
				"most of the full transcript is essential",
				"a summary and recall can provide enough context",
			),
		},
	};
}

/**
 * Decide the tier and action from token bands and the judgment.
 * `compact` means the caller should call `ctx.compact()`.
 */
export function decide(input: DecideInput): CompactDecision {
	const {
		config,
		usage: { tokens },
		judgment,
		keepRecentTokens,
		onCooldown,
		compactionPending,
	} = input;

	if (!config.enabled) return { tier: "silent", action: "none", reason: "disabled" };
	if (tokens == null) return { tier: "silent", action: "none", reason: "unknown token count" };
	if (tokens <= keepRecentTokens) {
		return { tier: "silent", action: "none", reason: "context fits in keepRecentTokens" };
	}

	if (compactionPending) return { tier: "silent", action: "none", reason: "compaction pending" };
	if (tokens >= config.highWaterTokens) {
		return { tier: "request", action: "compact", reason: "high-water" };
	}
	if (onCooldown) return { tier: "silent", action: "none", reason: "cooldown" };

	if (tokens >= config.recommendedTokens) {
		if (!judgment) return { tier: "recommend", action: "none", reason: "judgment unavailable" };
		if (judgment.mid_operation > 0.5) {
			return { tier: "recommend", action: "none", reason: "mid-operation" };
		}
		if (judgment.needs_history > 0.5) {
			return { tier: "recommend", action: "none", reason: "history still needed" };
		}
		if (judgment.objective_shift > config.taskShiftThreshold && judgment.at_boundary > 0.5) {
			return { tier: "request", action: "compact", reason: "objective shift" };
		}
		return { tier: "recommend", action: "none", reason: "same objective" };
	}

	if (tokens >= config.noticeTokens) {
		return { tier: "notice", action: "none", reason: "notice band" };
	}
	return { tier: "silent", action: "none", reason: "below notice band" };
}

const RECALL_GUIDELINE =
	"If you need detail that predates the compaction summary, call `vcc_recall` with keywords from the earlier work.";

/**
 * Return the recall guideline to append after a compaction, or null when the
 * summary already tells the model to use `vcc_recall`.
 */
export function recallGuideline(summary: string): string | null {
	return /vcc_recall/i.test(summary) ? null : RECALL_GUIDELINE;
}
