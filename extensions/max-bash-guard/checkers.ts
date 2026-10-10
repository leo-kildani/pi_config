/**
 * Probabilistic checker runner for the max-bash-guard extension.
 *
 * runCheckers sends the command to a set of checker calls on the session model.
 * A timeout or an error counts as an unknown reply, which is never safe.
 */

import type { Api, Model } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import type { MaxBashGuardConfig } from "./config.ts";
import { parseCheckerReply, summarizeVotes, type CheckerReply, type VoteSummary } from "./decide.ts";

export const CHECKER_SYSTEM_PROMPT = `You are a security checker. Review one bash command and decide if it is destructive.

Respond with a single word: SAFE or DESTRUCTIVE. Do not explain. Do not add any other text.

SAFE means the command is safe to run on a developer machine.
DESTRUCTIVE means the command can delete or overwrite data, expose secrets, or mutate cloud resources.`;

interface CheckerModel {
	model: Model<Api>;
	label: string;
}

interface CheckerOutcome {
	reply: CheckerReply;
	error?: string;
}

export interface CheckerRunResult {
	replies: CheckerReply[];
	summary: VoteSummary;
	errors: string[];
}

function extractText(content: ReadonlyArray<{ type: string; text?: string }>, separator = ""): string {
	return content
		.filter((block) => block.type === "text" && typeof block.text === "string")
		.map((block) => block.text)
		.join(separator);
}

function resolveCheckerModels(ctx: ExtensionContext): CheckerModel[] {
	const models: CheckerModel[] = [];
	if (ctx.model && ctx.modelRegistry.hasConfiguredAuth(ctx.model)) {
		models.push({ model: ctx.model, label: `${ctx.model.provider}/${ctx.model.id}` });
	}
	if (models.length === 0) {
		for (const scoped of ctx.scopedModels) {
			if (!ctx.modelRegistry.hasConfiguredAuth(scoped.model)) continue;
			models.push({ model: scoped.model, label: `${scoped.model.provider}/${scoped.model.id}` });
			break;
		}
	}
	return models;
}

function distributeCheckers(models: CheckerModel[], count: number): CheckerModel[] {
	if (models.length === 0) return [];
	return Array.from({ length: count }, (_, index) => models[index % models.length]!);
}

async function runOne(
	ctx: ExtensionContext,
	checker: CheckerModel,
	command: string,
	timeoutMs: number,
	parentSignal?: AbortSignal,
): Promise<CheckerOutcome> {
	const controller = new AbortController();
	let timedOut = false;
	const timer = setTimeout(() => {
		timedOut = true;
		controller.abort();
	}, timeoutMs);
	const onParentAbort = () => controller.abort();
	parentSignal?.addEventListener("abort", onParentAbort, { once: true });

	try {
		const response = await ctx.modelRegistry.complete(
			checker.model,
			{
				systemPrompt: CHECKER_SYSTEM_PROMPT,
				messages: [{
					role: "user" as const,
					content: [{ type: "text" as const, text: `Bash command:\n${command}` }],
					timestamp: Date.now(),
				}],
			},
			{ maxTokens: 8, signal: controller.signal },
		);

		if (response.stopReason === "aborted") {
			return { reply: "unknown", error: response.errorMessage ?? (timedOut ? `Timed out after ${timeoutMs}ms` : "Request aborted") };
		}
		if (response.stopReason === "error") {
			return { reply: "unknown", error: response.errorMessage ?? "API error" };
		}

		const reply = parseCheckerReply(extractText(response.content));
		if (reply === "unknown") {
			return { reply, error: `Unexpected checker reply for ${checker.label}` };
		}
		return { reply };
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		return { reply: "unknown", error: message };
	} finally {
		clearTimeout(timer);
		parentSignal?.removeEventListener("abort", onParentAbort);
	}
}

export async function runCheckers(
	ctx: ExtensionContext,
	command: string,
	config: MaxBashGuardConfig,
	signal?: AbortSignal,
): Promise<CheckerRunResult> {
	const models = resolveCheckerModels(ctx);
	if (models.length === 0) {
		return { replies: [], summary: summarizeVotes([]), errors: ["No checker model available"] };
	}

	const checkers = distributeCheckers(models, config.checkerCount);
	const outcomes = await Promise.all(checkers.map((checker) => runOne(ctx, checker, command, config.checkerTimeoutMs, signal)));
	const errors = outcomes.map((outcome) => outcome.error).filter((value): value is string => Boolean(value));
	return { replies: outcomes.map((outcome) => outcome.reply), summary: summarizeVotes(outcomes.map((outcome) => outcome.reply)), errors };
}
