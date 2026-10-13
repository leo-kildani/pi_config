/**
 * max-bash-guard — a guard for bash tool calls.
 *
 * The guard has three modes:
 *   off        run every command, no guard
 *   on         allow read-only commands, block secret reads, guard writes
 *   read-only  allow read-only commands only, block the rest
 *
 * In on mode the guard runs four steps. A secret read and a destructive or
 * write command prompt the user. A scope violation blocks. A read-only command
 * is an allow. Every other command goes to one classifier check when the
 * checker is on. A safe reply is an allow, and every other reply prompts the
 * user.
 *
 * The prompt shows the full command, a short reason, and an allow or deny
 * choice. The destructive sub-command appears in bold and the error color.
 *
 * The scope setting bounds the paths a command may touch. The values are off,
 * cwd, and custom. custom reads SCOPE from maxguard.env in the working
 * directory.
 *
 * State lives in a custom session entry, so it survives session resume. The
 * mode switches with the /maxguard command or the --max-guard-mode flag.
 */

import {
	DynamicBorder,
	isToolCallEventType,
	type ExtensionAPI,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Container, type SettingItem, SettingsList, Text } from "@earendil-works/pi-tui";

import { analyzeCommand, splitCommandChain } from "./analyze.ts";
import { runCheckers, type CheckerRunResult } from "./checkers.ts";
import { DEFAULT_CONFIG, parseCheckerEnabled, parseGuardMode, parseScopeMode, type GuardMode, type ScopeMode } from "./config.ts";
import { afterVotes, decideGuardStep, type CommandCategory } from "./decide.ts";
import { commandReadsSecrets, evaluateCommandPolicy } from "./policy.ts";
import { evaluateReadOnlyCommand } from "./read-only.ts";
import { evaluateScope, resolveScopePath } from "./scope.ts";
import { promptForDecision } from "./ui.ts";

const STATE_ENTRY = "max-bash-guard-state";
const STATUS_KEY = "max-bash-guard";
const TITLE = "🛡 Bash guard";

interface GuardState {
	mode: GuardMode;
	scope?: ScopeMode;
	checkerModel?: string;
	checkerEnabled?: boolean;
	timestamp: number;
}

type GuardDecision = { allowed: true } | { allowed: false; reason: string };

export default function (pi: ExtensionAPI) {
	let mode: GuardMode = DEFAULT_CONFIG.mode;
	let scope: ScopeMode = DEFAULT_CONFIG.scope;
	let checkerModel: string | undefined;
	let checkerEnabled = DEFAULT_CONFIG.checkerEnabled;

	function checkerConfig() {
		return { ...DEFAULT_CONFIG, checkerModel, checkerEnabled };
	}

	function updateStatus(ctx: ExtensionContext): void {
		ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg(mode === "off" ? "dim" : "success", `🛡: ${mode}`));
	}

	function persistState(): void {
		pi.appendEntry<GuardState>(STATE_ENTRY, { mode, scope, checkerModel, checkerEnabled, timestamp: Date.now() });
	}

	async function askUser(ctx: ExtensionContext, command: string, reason: string, scopePath?: string): Promise<GuardDecision> {
		const analysis = analyzeCommand(command, ctx.cwd, scopePath);
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
		return `Checker did not agree the command is safe (${safe} safe, ${destructive} destructive, ${unknown} unknown of ${total}).`;
	}

	function categorize(command: string, cwd: string, scopePath: string | undefined): CommandCategory {
		if (commandReadsSecrets(command, cwd)) return "secret";
		let sawUnknown = false;
		for (const segment of splitCommandChain(command)) {
			if (scopePath && evaluateScope(segment.text, cwd, scopePath).action === "review") return "scope";
			if (evaluateReadOnlyCommand(segment.text, cwd).action === "allow") continue;
			if (evaluateCommandPolicy(segment.text, cwd).action === "review") return "write";
			sawUnknown = true;
		}
		return sawUnknown ? "unknown" : "read-only";
	}

	function categoryReason(command: string, cwd: string, category: CommandCategory, scopePath: string | undefined): string {
		if (category === "secret") return "command reads a secret";
		if (category === "scope") {
			for (const segment of splitCommandChain(command)) {
				const decision = evaluateScope(segment.text, cwd, scopePath);
				if (decision.action === "review") return decision.reason;
			}
			return "path outside scope";
		}
		if (category === "write") {
			const policy = evaluateCommandPolicy(command, cwd);
			return policy.action === "review" ? policy.reason : "write or destructive command";
		}
		return "command is not proven read-only";
	}

	async function guardCommand(ctx: ExtensionContext, command: string): Promise<GuardDecision> {
		if (mode === "off") return { allowed: true };

		const scopePath = resolveScopePath(scope, ctx.cwd);
		const category = categorize(command, ctx.cwd, scopePath);
		const step = decideGuardStep(mode, category, checkerEnabled);

		if (step === "run") return { allowed: true };
		if (step === "block") {
			const reason = categoryReason(command, ctx.cwd, category, scopePath);
			const suffix = category === "scope" ? "Blocked outside scope." : "Blocked in read-only mode.";
			return { allowed: false, reason: `${TITLE}: ${reason}. ${suffix}` };
		}
		if (step === "prompt") {
			return askUser(ctx, command, categoryReason(command, ctx.cwd, category, scopePath), scopePath);
		}

		const result = await runCheckers(ctx, command, checkerConfig(), ctx.signal);
		if (afterVotes(result.summary) === "run") {
			if (ctx.hasUI) ctx.ui.notify("✅ Bash guard: the checker reports the command is safe.", "info");
			return { allowed: true };
		}
		return askUser(ctx, command, voteReason(result), scopePath);
	}

	pi.registerFlag("max-guard-mode", {
		description: "Bash guard mode: off, on, or read-only",
		type: "string",
		default: DEFAULT_CONFIG.mode,
	});

	pi.registerCommand("maxguard", {
		description: "Configure the bash guard mode and checker",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("/maxguard requires TUI mode", "warning");
				return;
			}

			const availableModels = await ctx.modelRegistry.getAvailableOfType("classifier");
			const modelIds = availableModels.map((model) => `${model.provider}/${model.id}`);
			if (modelIds.length > 0 && !modelIds.includes(checkerModel ?? "")) {
				checkerModel = modelIds[0];
				persistState();
			}

			await ctx.ui.custom((tui, theme, _keybindings, done) => {
				const items: SettingItem[] = [
					{
						id: "mode",
						label: "Mode",
						currentValue: mode,
						values: ["off", "on", "read-only"],
					},
					{
						id: "scope",
						label: "Scope",
						currentValue: scope,
						values: ["off", "cwd", "custom"],
						description: 'set scope in `maxguard.env` using "SCOPE=<path>"',
					},
				];
				if (modelIds.length > 0) {
					items.push({
						id: "checkerModel",
						label: "Checker model",
						currentValue: checkerModel!,
						values: modelIds,
					});
				}
				items.push({
					id: "checker",
					label: "Checker",
					currentValue: checkerEnabled ? "on" : "off",
					values: ["on", "off"],
				});
				const container = new Container();
				container.addChild(new DynamicBorder((text) => theme.fg("accent", text)));
				container.addChild(new Text(theme.fg("accent", theme.bold("Bash Guard Settings"))));

				const settingsList = new SettingsList(
					items,
					Math.min(items.length, 8),
					{
						label: (text, selected) => (selected ? theme.fg("accent", text) : text),
						value: (text, selected) => theme.fg(selected ? "accent" : "muted", text),
						description: (text) => theme.fg("dim", text),
						cursor: theme.fg("accent", "→ "),
						hint: (text) => theme.fg("dim", text),
					},
					(id, newValue) => {
						if (id === "mode") {
							mode = parseGuardMode(newValue, mode);
							updateStatus(ctx);
						} else if (id === "scope") {
							scope = parseScopeMode(newValue, scope);
						} else if (id === "checkerModel") {
							checkerModel = newValue;
						} else if (id === "checker") {
							checkerEnabled = parseCheckerEnabled(newValue, checkerEnabled);
						}
						persistState();
					},
					() => done(undefined),
				);
				container.addChild(settingsList);
				if (modelIds.length === 0) {
					container.addChild(new Text(theme.fg("warning", "No authenticated classifier models. Use /login to enable checkers.")));
				}
				container.addChild(new DynamicBorder((text) => theme.fg("accent", text)));

				return {
					render(width: number) {
						return container.render(width);
					},
					invalidate() {
						container.invalidate();
					},
					handleInput(data: string) {
						settingsList.handleInput(data);
						tui.requestRender();
					},
				};
			});
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
			if (typeof data?.scope === "string") scope = parseScopeMode(data.scope, scope);
			if (typeof data?.checkerModel === "string") checkerModel = data.checkerModel;
			if (typeof data?.checkerEnabled === "boolean") checkerEnabled = data.checkerEnabled;
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
