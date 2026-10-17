/**
 * Pure vote helpers for the max-bash-guard extension.
 *
 * summarizeVotes counts each checker reply. afterVotes applies the
 * single-checker result.
 */

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

export function afterVotes(summary: VoteSummary): "run" | "prompt" {
	return summary.safe >= 1 ? "run" : "prompt";
}
