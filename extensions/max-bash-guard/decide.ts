/**
 * Pure decision pipeline for the max-bash-guard extension.
 *
 * decideGuardStep maps the mode, the command category, and the checker setting
 * to a guard step. afterVotes applies the single-checker result.
 */

import type { GuardMode } from "./config.ts";

export type CommandCategory = "read-only" | "secret" | "write" | "unknown";
export type GuardStep = "run" | "block" | "prompt" | "vote";
export type CheckerReply = "safe" | "destructive" | "unknown";

export interface VoteSummary {
	safe: number;
	destructive: number;
	unknown: number;
	total: number;
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

export function decideGuardStep(mode: GuardMode, category: CommandCategory, checkerEnabled: boolean): GuardStep {
	if (mode === "off") return "run";
	if (category === "read-only") return "run";
	if (mode === "read-only") return "block";
	// In on mode every caught command prompts the user. Secret and write
	// commands never reach the checker. Only unknown commands may auto-allow.
	if (category === "secret" || category === "write") return "prompt";
	return checkerEnabled ? "vote" : "prompt";
}

export function afterVotes(summary: VoteSummary): GuardStep {
	return summary.safe >= 1 ? "run" : "prompt";
}
