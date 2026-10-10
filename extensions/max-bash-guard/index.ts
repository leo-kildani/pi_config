/**
 * max-bash-guard — a two-layer guard for bash tool calls.
 *
 * The guard has three modes:
 *   free   run every command, no guard
 *   trial  run the deterministic policy only
 *   jail   run the deterministic policy, then three probabilistic checkers
 *
 * A deterministic review opens the prompt in trial and jail mode. In jail mode,
 * a deterministic pass continues to three checkers. Two safe checker replies let
 * the command run. Any other result opens the prompt.
 *
 * The prompt shows the full command, a short reason, and an allow or deny
 * choice. The destructive sub-command appears in bold and the error color.
 *
 * State lives in a custom session entry, so it survives session resume. The
 * mode switches with the /maxguard command or the --max-guard-mode flag.
 */

import {
	isToolCallEventType,
	type ExtensionAPI,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";

import { analyzeCommand } from "./analyze.ts";
import { runCheckers, type CheckerRunResult } from "./checkers.ts";
import { DEFAULT_CONFIG, parseGuardMode, type GuardMode } from "./config.ts";
import { afterDeterministic, afterVotes } from "./decide.ts";
import { evaluateCommandPolicy } from "./policy.ts";
import { promptForDecision } from "./ui.ts";

const STATE_ENTRY = "max-bash-guard-state";
const STATUS_KEY = "max-bash-guard";
const TITLE = "🛡 Bash guard";

interface GuardState {
	mode: GuardMode;
	timestamp: number;
}

type GuardDecision = { allowed: true } | { allowed: false; reason: string };

export default function (pi: ExtensionAPI) {
	let mode: GuardMode = DEFAULT_CONFIG.mode;

	function updateStatus(ctx: ExtensionContext): void {
		const text = mode === "free" ? "guard off" : mode === "trial" ? "guard trial" : "guard jail";
		ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg(mode === "free" ? "dim" : "success", text));
	}

	function persistState(): void {
		pi.appendEntry<GuardState>(STATE_ENTRY, { mode, timestamp: Date.now() });
	}

	async function askUser(ctx: ExtensionContext, command: string, reason: string): Promise<GuardDecision> {
		const analysis = analyzeCommand(command, ctx.cwd, { profile: DEFAULT_CONFIG.policyProfile });
		if (!ctx.hasUI) {
			return { allowed: false, reason: `${TITLE}: ${reason}. Blocked in non-interactive mode.` };
		}
		if (ctx.mode === "tui") {
			const allowed = await promptForDecision(ctx, { title: TITLE, command, spans: analysis.spans, reason });
			return allowed ? { allowed: true } : { allowed: false, reason: `${TITLE}: ${reason}. User denied.` };
		}
		const allowed = await ctx.ui.confirm(TITLE, `$ ${command}\n\n${reason}\n\nAllow this command?`);
		return allowed ? { allowed: true } : { allowed: false, reason: `${TITLE}: ${reason}. User denied.` };
	}

	function voteReason(result: CheckerRunResult): string {
		const { safe, destructive, unknown, total } = result.summary;
		return `Checkers did not agree the command is safe (${safe} safe, ${destructive} destructive, ${unknown} unknown of ${total}).`;
	}

	async function guardCommand(ctx: ExtensionContext, command: string): Promise<GuardDecision> {
		if (mode === "free") return { allowed: true };

		const policy = evaluateCommandPolicy(command, ctx.cwd, { profile: DEFAULT_CONFIG.policyProfile });
		const step = afterDeterministic(mode, policy.action);

		if (step === "run") return { allowed: true };
		if (step === "ask") {
			return askUser(ctx, command, policy.action === "review" ? policy.reason : "Manual review required.");
		}

		const result = await runCheckers(ctx, command, DEFAULT_CONFIG, ctx.signal);
		if (afterVotes(result.summary, DEFAULT_CONFIG) === "run") {
			if (ctx.hasUI) ctx.ui.notify(`✅ Bash guard: ${result.summary.safe}/${result.summary.total} checkers report safe.`, "info");
			return { allowed: true };
		}
		return askUser(ctx, command, voteReason(result));
	}

	pi.registerFlag("max-guard-mode", {
		description: "Bash guard mode: free, trial, or jail",
		type: "string",
		default: DEFAULT_CONFIG.mode,
	});

	pi.registerCommand("maxguard", {
		description: "Set the bash guard mode: free, trial, or jail",
		handler: async (args, ctx) => {
			const value = args.trim().toLowerCase();
			if (!value) {
				ctx.ui.notify(`Bash guard mode: ${mode}`, "info");
				return;
			}
			if (value !== "free" && value !== "trial" && value !== "jail") {
				ctx.ui.notify("Usage: /maxguard free|trial|jail", "warning");
				return;
			}
			mode = value;
			persistState();
			updateStatus(ctx);
			ctx.ui.notify(`Bash guard mode: ${mode}`, "info");
		},
	});

	pi.on("session_start", (_event, ctx) => {
		const flag = pi.getFlag("max-guard-mode");
		if (typeof flag === "string") mode = parseGuardMode(flag, mode);

		const entries = ctx.sessionManager.getEntries();
		for (let i = entries.length - 1; i >= 0; i--) {
			const entry = entries[i];
			if (entry.type !== "custom" || entry.customType !== STATE_ENTRY) continue;
			const data = entry.data as Partial<GuardState> | undefined;
			if (typeof data?.mode === "string") mode = parseGuardMode(data.mode, mode);
			break;
		}

		updateStatus(ctx);
	});

	pi.on("tool_call", async (event, ctx) => {
		if (!isToolCallEventType("bash", event)) return;
		const decision = await guardCommand(ctx, event.input.command);
		if (!decision.allowed) return { block: true, reason: decision.reason };
	});
}
