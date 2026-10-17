/**
 * Probabilistic judge for the max-bash-guard extension.
 *
 * judgeCommand sends one command to one classifier model. The verdict is
 * NOT_HARMFUL or one harm reason. A timeout or an error counts as harmful, so
 * the guard fails closed.
 */

import type { ClassifierApi, ClassifierModel } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import type { MaxBashGuardConfig } from "./config.ts";

export const HARM_REASONS = {
	DATA_DESTRUCTION: "data destruction",
	DISK_CORRUPTION: "disk corruption",
	PRIVILEGE_ESCALATION: "privilege escalation",
	SHELL_INJECTION: "shell injection",
	UNSAFE_EVALUATION: "unsafe evaluation",
	REMOTE_CODE_EXECUTION: "remote code execution",
	DATA_EXFILTRATION: "data exfiltration",
	INSECURE_PERMISSIONS: "insecure permissions",
	FORK_BOMB: "fork bomb",
	RESOURCE_EXHAUSTION: "resource exhaustion",
	HOSTILE_NETWORK: "hostile network activity",
	FILE_CLOBBERING: "file clobbering",
	INTERACTIVE_HANG: "interactive hang",
	PAGER_ESCAPE: "pager escape",
	ARGUMENT_INJECTION: "argument injection",
	ENVIRONMENT_POISONING: "environment poisoning",
	HIDDEN_SIDE_EFFECT: "hidden side effect",
	UNSAFE_GLOBBING: "unsafe globbing",
	PROCESS_DISRUPTION: "process disruption",
	INSECURE_TEMP_FILE: "insecure temp file",
	PERSISTENCE: "persistence",
	NETWORK_DISRUPTION: "network disruption",
} as const;

export type HarmReason = keyof typeof HARM_REASONS;

export type JudgeResult =
	| { harmful: false }
	| { harmful: true; reason: string };

const NOT_HARMFUL = "NOT_HARMFUL";

const HARM_CRITERIA: Record<HarmReason, string> = {
	DATA_DESTRUCTION: "Permanently deletes or overwrites data, such as rm -rf /, shred, or wipefs.",
	DISK_CORRUPTION: "Writes raw data to a block device or formats the wrong drive, such as dd of=/dev/sda or mkfs.",
	PRIVILEGE_ESCALATION: "Gains root or setuid access, such as sudo, chown root, or chmod +s.",
	SHELL_INJECTION: "Runs hidden commands through metacharacters, backticks, subshells, or command chaining.",
	UNSAFE_EVALUATION: "Runs dynamic code with eval, source, or dot.",
	REMOTE_CODE_EXECUTION: "Downloads and runs code from an untrusted source, such as curl piped to bash.",
	DATA_EXFILTRATION: "Sends secrets out or prints credentials, .env files, or SSH keys.",
	INSECURE_PERMISSIONS: "Removes write protection or grants broad permissions, such as chmod 777 -R /.",
	FORK_BOMB: "Starts an infinite process loop or fork bomb.",
	RESOURCE_EXHAUSTION: "Uses unbounded memory, CPU, disk, or background jobs.",
	HOSTILE_NETWORK: "Scans ports, opens reverse shells, or starts covert tunnels.",
	FILE_CLOBBERING: "Redirects output over a wrong target or truncates a source file.",
	INTERACTIVE_HANG: "Waits for input or terminal interaction, such as vi, nano, read, or unpiped less.",
	PAGER_ESCAPE: "Runs shell commands through a pager, such as less, more, or man.",
	ARGUMENT_INJECTION: "Uses options to run commands or alter behavior, such as find -exec, awk system, git -c, or rsync -e.",
	ENVIRONMENT_POISONING: "Changes PATH, LD_PRELOAD, PYTHONPATH, or aliases to untrusted values.",
	HIDDEN_SIDE_EFFECT: "Writes or alters data through a command that looks read-only, such as sort -o or sed -i.",
	UNSAFE_GLOBBING: "Expands unquoted wildcards or splits words into unintended files or flags.",
	PROCESS_DISRUPTION: "Kills critical processes or sends signals to a broad process set, such as kill -9 -1 or killall.",
	INSECURE_TEMP_FILE: "Creates a predictable temporary file that enables a symlink race.",
	PERSISTENCE: "Adds a cron job, edits .bashrc, or creates a systemd service without authorization.",
	NETWORK_DISRUPTION: "Changes firewall rules or disables a network interface.",
};

const VERDICT_CRITERIA: Record<string, string> = {
	[NOT_HARMFUL]: "The command is routine and has no listed harm.",
	...HARM_CRITERIA,
};

interface JudgeModel {
	model: ClassifierModel<ClassifierApi>;
	label: string;
}

async function resolveJudgeModel(ctx: ExtensionContext, modelId?: string): Promise<JudgeModel | undefined> {
	const models = await ctx.modelRegistry.getAvailableOfType("classifier");
	const model = modelId === undefined
		? models[0]
		: models.find((candidate) => `${candidate.provider}/${candidate.id}` === modelId);
	return model ? { model, label: `${model.provider}/${model.id}` } : undefined;
}

export async function judgeCommand(
	ctx: ExtensionContext,
	command: string,
	config: MaxBashGuardConfig,
	signal?: AbortSignal,
): Promise<JudgeResult> {
	const judge = await resolveJudgeModel(ctx, config.checkerModel);
	if (!judge) {
		return {
			harmful: true,
			reason: config.checkerModel
				? `judge model is unavailable: ${config.checkerModel}`
				: "no judge model is available",
		};
	}

	const controller = new AbortController();
	let timedOut = false;
	const timer = setTimeout(() => {
		timedOut = true;
		controller.abort();
	}, config.checkerTimeoutMs);
	const onParentAbort = () => controller.abort();
	signal?.addEventListener("abort", onParentAbort, { once: true });

	try {
		const response = await ctx.modelRegistry.classify(
			judge.model,
			{
				state: { command },
				questions: {
					verdict: {
						type: "choice",
						instructions: "Judge whether this bash command is potentially harmful on a developer machine.",
						criteria: VERDICT_CRITERIA,
					},
				},
			},
			{ signal: controller.signal },
		);

		if (response.stopReason === "aborted") {
			const detail = response.errorMessage ?? (timedOut ? `timed out after ${config.checkerTimeoutMs}ms` : "request aborted");
			return { harmful: true, reason: `judge failed: ${detail}` };
		}
		if (response.stopReason === "error") {
			return { harmful: true, reason: `judge failed: ${response.errorMessage ?? "API error"}` };
		}

		const answer = response.answers.verdict;
		const choice = answer?.type === "choice" ? answer.choice : undefined;
		if (choice === NOT_HARMFUL) return { harmful: false };
		if (choice !== undefined && Object.hasOwn(HARM_REASONS, choice)) {
			return { harmful: true, reason: HARM_REASONS[choice as HarmReason] };
		}
		return { harmful: true, reason: `judge returned an unknown verdict from ${judge.label}: ${choice ?? "missing"}` };
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		return { harmful: true, reason: `judge failed: ${message}` };
	} finally {
		clearTimeout(timer);
		signal?.removeEventListener("abort", onParentAbort);
	}
}
