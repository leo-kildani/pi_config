/**
 * Plan extension
 *
 * /plan <objective>  create a plan, or edit the pending one
 * /plan build        execute the pending plan
 * /plan show         toggle the Current Plan widget
 *
 * One plan is current per session. A plan is "pending" until its build run
 * finishes, then it is "built". A built plan stays current: /plan build reports
 * it, and /plan <objective> starts a fresh plan.
 *
 * State lives in a custom session entry, so it is branch-aware and survives
 * resume. Plan files live in <agentDir>/plans.
 */

import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem } from "@earendil-works/pi-tui";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
	buildAction,
	buildInstructions,
	editInstructions,
	planAction,
	planFileName,
	planInstructions,
	plansDirectory,
	synthesizePlanName,
	type PlanPhase,
} from "./logic.ts";

const PLANS_DIR = plansDirectory(getAgentDir());
const STATE_ENTRY = "plan-state";

interface PlanState {
	sessionId: string;
	planPath: string;
	phase: PlanPhase;
	widgetVisible: boolean;
}

let state: PlanState | null = null;
// True between /plan build and the agent_end that finishes it.
let building = false;

/** First free path for <name>-<sessionId>.md; a collision gets a -2, -3, ... suffix. */
function uniquePlanPath(name: string, sessionId: string): string {
	const file = planFileName(name, sessionId);
	const base = file.replace(/\.md$/, "");
	let path = join(PLANS_DIR, file);
	for (let i = 2; existsSync(path); i++) path = join(PLANS_DIR, `${base}-${i}.md`);
	return path;
}

/** Rebuild state from the session branch, so the current plan matches the branch point. */
function reconstructState(ctx: ExtensionContext): void {
	state = null;
	building = false;
	const sessionId = ctx.sessionManager.getSessionId();
	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type !== "custom" || entry.customType !== STATE_ENTRY) continue;
		const data = entry.data as PlanState | undefined;
		if (data && data.sessionId === sessionId) {
			state = { ...data, widgetVisible: data.widgetVisible !== false };
		}
	}
}

/** Show the current plan path and state above the editor while the widget is on. */
function syncWidget(ctx: ExtensionContext): void {
	if (!state || !state.widgetVisible) {
		ctx.ui.setWidget("plan", undefined);
		return;
	}
	const theme = ctx.ui.theme;
	ctx.ui.setWidget("plan", [
		theme.fg("accent", `Current Plan: ${state.planPath}`),
		theme.fg("muted", `Status: ${state.phase}`),
	]);
}

export default function (pi: ExtensionAPI): void {
	const persistState = (): void => {
		if (state) pi.appendEntry(STATE_ENTRY, state);
	};

	const currentFor = (sessionId: string): PlanState | null =>
		state && state.sessionId === sessionId ? state : null;

	pi.registerCommand("plan", {
		description: "Plan workflow: <objective> to create or edit, 'build' to execute, 'show' to toggle",
		getArgumentCompletions: (prefix: string): AutocompleteItem[] | null => {
			const p = prefix.trim().toLowerCase();
			const matches = ["build", "show"].filter((option) => option.startsWith(p));
			return matches.length ? matches.map((value) => ({ value, label: value })) : null;
		},
		handler: async (args, ctx) => {
			const raw = args.trim();
			const sessionId = ctx.sessionManager.getSessionId();

			// /plan show — toggle the widget. Pure UI, so it works while the agent is busy.
			if (raw === "show") {
				const current = currentFor(sessionId);
				if (!current) {
					ctx.ui.notify("No plan set. Run /plan <objective> first.", "warning");
					return;
				}
				state = { ...current, widgetVisible: !current.widgetVisible };
				persistState();
				syncWidget(ctx);
				ctx.ui.notify(state.widgetVisible ? "Plan widget shown" : "Plan widget hidden", "info");
				return;
			}

			// /plan build — execute the pending plan.
			if (raw === "build") {
				const action = buildAction(currentFor(sessionId)?.phase ?? null);
				if (action === "none") {
					ctx.ui.notify("No plan set.", "warning");
					return;
				}
				if (action === "already") {
					ctx.ui.notify("Current Plan Built", "info");
					return;
				}
				if (!ctx.isIdle()) {
					ctx.ui.notify("The agent is busy. /plan needs an idle session.", "warning");
					return;
				}
				building = true;
				ctx.ui.notify(`Building: ${state!.planPath}`, "info");
				pi.sendUserMessage(buildInstructions(state!.planPath));
				return;
			}

			let objective = raw;
			if (!objective && ctx.hasUI) {
				objective = (await ctx.ui.input("Plan objective", "e.g. Add a plugin system"))?.trim() ?? "";
			}
			if (!objective) {
				ctx.ui.notify("Usage: /plan <objective> | build | show", "warning");
				return;
			}
			if (!ctx.isIdle()) {
				ctx.ui.notify("The agent is busy. /plan needs an idle session.", "warning");
				return;
			}

			const current = currentFor(sessionId);
			if (planAction(current?.phase ?? null) === "edit") {
				state = { ...current!, phase: "pending" };
				persistState();
				syncWidget(ctx);
				ctx.ui.notify(`Editing plan: ${state.planPath}`, "info");
				pi.sendUserMessage(editInstructions(state.planPath, objective));
				return;
			}

			const planPath = uniquePlanPath(synthesizePlanName(objective), sessionId);
			state = { sessionId, planPath, phase: "pending", widgetVisible: state?.widgetVisible ?? true };
			persistState();
			syncWidget(ctx);
			ctx.ui.notify(`Plan target: ${planPath}`, "info");
			pi.sendUserMessage(planInstructions(planPath, objective));
		},
	});

	// The build run ends: mark the plan built.
	pi.on("agent_end", async (_event, ctx) => {
		if (!building || !state) return;
		building = false;
		state = { ...state, phase: "built" };
		persistState();
		syncWidget(ctx);
		ctx.ui.notify("Current Plan Built", "info");
	});

	// Rebuild state on load, switch, and tree navigate.
	const rebuild = (_event: unknown, ctx: ExtensionContext): void => {
		reconstructState(ctx);
		syncWidget(ctx);
	};
	pi.on("session_start", rebuild);
	pi.on("session_tree", rebuild);
}
