/**
 * max-bash-guard — a guard for bash tool calls.
 *
 * The guard has three modes:
 *   off        run every command, no guard
 *   on         allow read-only commands, block secret reads, guard writes
 *   read-only  allow read-only commands only, block the rest
 *
 * In on mode the guard splits a chain into one item per command. It runs the
 * deterministic guard on each item. A secret read, a scope violation, or a
 * policy violation blocks the item. A proven read-only item is safe. Every
 * other safe item goes to one classifier check. A safe reply keeps the item
 * safe.
 *
 * The guard runs the full command when no item is blocked. Otherwise the prompt
 * shows the full command with every blocked item in bold. It lists every block
 * reason and offers an allow or deny choice.
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

import { evaluateCommandChain, type CommandVerdict } from "./analyze.ts";
import { runCheckers, type CheckerRunResult } from "./checkers.ts";
import { DEFAULT_CONFIG, parseCheckerEnabled, parseGuardMode, parseScopeMode, type GuardMode, type ScopeMode } from "./config.ts";
import { afterVotes } from "./decide.ts";
import { resolveScopePath } from "./scope.ts";
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

	function blockReasons(blocked: readonly CommandVerdict[]): string[] {
		return blocked.map((item, index) => `${index + 1}. ${item.reason ?? "blocked"}`);
	}

	async function askUser(ctx: ExtensionContext, command: string, blocked: readonly CommandVerdict[]): Promise<GuardDecision> {
		const reasons = blockReasons(blocked);
		const summary = reasons.join("; ");
		if (!ctx.hasUI) {
			return { allowed: false, reason: `${TITLE}: ${summary}. Blocked in non-interactive mode.` };
		}
		if (ctx.mode === "tui") {
			const allowed = await promptForDecision(ctx, { title: TITLE, command, spans: blocked, reasons });
			return allowed ? { allowed: true } : { allowed: false, reason: `${TITLE}: ${summary}. User denied.` };
		}
		const allowed = await ctx.ui.confirm(TITLE, `$ ${command}\n\n${reasons.join("\n")}\n\nAllow this command?`);
		return allowed ? { allowed: true } : { allowed: false, reason: `${TITLE}: ${summary}. User denied.` };
	}

	function voteReason(result: CheckerRunResult): string {
		const { safe, destructive, unknown, total } = result.summary;
		return `Checker did not agree the command is safe (${safe} safe, ${destructive} destructive, ${unknown} unknown of ${total}).`;
	}

	async function guardCommand(ctx: ExtensionContext, command: string): Promise<GuardDecision> {
		if (mode === "off") return { allowed: true };

		const scopePath = resolveScopePath(scope, ctx.cwd);
		const verdicts = evaluateCommandChain(command, ctx.cwd, scopePath, mode);
		const blocked = verdicts.filter((item) => !item.safe);
		let checkerRan = false;

		for (const item of verdicts) {
			if (!item.safe || item.provenReadOnly) continue;
			if (!checkerEnabled) {
				item.safe = false;
				item.reason = "the checker is off and the guard cannot prove this command safe";
				blocked.push(item);
				continue;
			}
			const result = await runCheckers(ctx, item.text, checkerConfig(), ctx.signal);
			checkerRan = true;
			if (afterVotes(result.summary) === "run") continue;
			item.safe = false;
			item.reason = voteReason(result);
			blocked.push(item);
		}

		blocked.sort((a, b) => a.start - b.start);

		if (blocked.length === 0) {
			if (checkerRan && ctx.hasUI) ctx.ui.notify("✅ Bash guard: the checker reports the command is safe.", "info");
			return { allowed: true };
		}

		if (mode === "read-only") {
			const reasons = blockReasons(blocked).join("; ");
			return { allowed: false, reason: `${TITLE}: ${reasons}. Blocked in read-only mode.` };
		}

		return askUser(ctx, command, blocked);
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
