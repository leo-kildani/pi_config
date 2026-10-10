/**
 * Pure decision pipeline for the max-bash-guard extension.
 *
 * afterDeterministic maps the mode and the deterministic decision to run, vote,
 * or ask. afterVotes applies the safe-vote threshold to the checker replies.
 */

import type { GuardMode } from "./config.ts";

export type DeterministicDecision = "none" | "allow" | "review";
export type GuardStep = "run" | "vote" | "ask";
export type CheckerReply = "safe" | "destructive" | "unknown";

export interface VoteSummary {
	safe: number;
	destructive: number;
	unknown: number;
	total: number;
}

export interface VotePolicy {
	checkerCount: number;
	minSafeVotes: number;
}

export function parseCheckerReply(text: string): CheckerReply {
	const normalized = text.trim().toUpperCase();
	if (normalized.startsWith("SAFE")) return "safe";
	if (normalized.startsWith("DESTRUCTIVE")) return "destructive";
	return "unknown";
}

export function summarizeVotes(replies: readonly CheckerReply[]): VoteSummary {
	let safe = 0;
	let destructive = 0;
	let unknown = 0;
	for (const reply of replies) {
		if (reply === "safe") safe += 1;
		else if (reply === "destructive") destructive += 1;
		else unknown += 1;
	}
	return { safe, destructive, unknown, total: replies.length };
}

export function afterDeterministic(mode: GuardMode, decision: DeterministicDecision): GuardStep {
	if (mode === "free") return "run";
	if (decision === "review") return "ask";
	if (mode === "trial") return "run";
	return "vote";
}

export function afterVotes(summary: VoteSummary, policy: VotePolicy): GuardStep {
	return summary.safe >= policy.minSafeVotes ? "run" : "ask";
}
