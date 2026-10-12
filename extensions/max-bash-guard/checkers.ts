/**
 * Probabilistic checker runner for the max-bash-guard extension.
 *
 * runCheckers sends the command to available System One classifier models.
 * A timeout or an error counts as an unknown reply, which is never safe.
 */

import type { ClassifierApi, ClassifierModel } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import type { MaxBashGuardConfig } from "./config.ts";
import { summarizeVotes, type CheckerReply, type VoteSummary } from "./decide.ts";

interface CheckerModel {
	model: ClassifierModel<ClassifierApi>;
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

async function resolveCheckerModel(ctx: ExtensionContext, modelId?: string): Promise<CheckerModel | undefined> {
	const models = await ctx.modelRegistry.getAvailableOfType("classifier");
	const model = modelId === undefined
		? models[0]
		: models.find((candidate) => `${candidate.provider}/${candidate.id}` === modelId);
	return model ? { model, label: `${model.provider}/${model.id}` } : undefined;
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
		const response = await ctx.modelRegistry.classify(
			checker.model,
			{
				state: { command },
				questions: {
					safety: {
						type: "choice",
						instructions: "Classify this bash command as safe or destructive on a developer machine.",
						criteria: {
							SAFE: "Safe to run on a developer machine.",
							DESTRUCTIVE: "Can delete or overwrite data, expose secrets, or mutate cloud resources.",
						},
					},
				},
			},
			{ signal: controller.signal },
		);

		if (response.stopReason === "aborted") {
			return { reply: "unknown", error: response.errorMessage ?? (timedOut ? `Timed out after ${timeoutMs}ms` : "Request aborted") };
		}
		if (response.stopReason === "error") {
			return { reply: "unknown", error: response.errorMessage ?? "API error" };
		}

		const answer = response.answers.safety;
		const choice = answer?.type === "choice" ? answer.choice : undefined;
		const reply: CheckerReply = choice === "SAFE" ? "safe" : choice === "DESTRUCTIVE" ? "destructive" : "unknown";
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
	const checker = await resolveCheckerModel(ctx, config.checkerModel);
	if (!checker) {
		const error = config.checkerModel
			? `Selected checker model is unavailable: ${config.checkerModel}`
			: "No checker model available";
		return { replies: [], summary: summarizeVotes([]), errors: [error] };
	}

	const checkers = Array.from({ length: config.checkerCount }, () => checker);
	const outcomes = await Promise.all(checkers.map((checker) => runOne(ctx, checker, command, config.checkerTimeoutMs, signal)));
	const errors = outcomes.map((outcome) => outcome.error).filter((value): value is string => Boolean(value));
	return { replies: outcomes.map((outcome) => outcome.reply), summary: summarizeVotes(outcomes.map((outcome) => outcome.reply)), errors };
}
