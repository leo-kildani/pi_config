/**
 * Plan extension
 *
 * Registers the /plan command:
 *   /plan <request>  create or edit a plan (the classifier picks the intent)
 *   /plan build      execute the active plan
 *   /plan show       toggle the Current Plan widget
 *   /plan validate   validate the active plan without dispatching an agent
 *
 * The command routes each request through Pi's classifier (TypeSafe Jev) to
 * one of three handlers: createPlan, editPlan, or buildPlan. createPlan derives
 * the final file name from the objective up front, so a plan keeps one path for
 * its whole life. editPlan changes the active file in place. A tool_call guard
 * blocks writes to any other plan file while a plan is active. The widget (and
 * the /plan show toggle) shows the Current Plan file above the input box while
 * a plan is active.
 *
 * /plan build resolves the plan file (recorded plan, else newest for the
 * session), sets phase "executing", and dispatches the
 * build workflow. The agent loads the plan's Execution Todos into write-todos
 * in one call, which replaces any previous list.
 *
 * While phase is "executing" and work remains, before_agent_start appends a
 * gating directive to the system prompt so the agent stays bound to the plan.
 * When every todo is complete and every listed verification command succeeds,
 * phase flips to "done" and the gate and widget drop.
 *
 * State lives in a custom session entry, so it is branch-aware and survives
 * session resume. Plans are stored in Pi's configured agent directory.
 */

import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem } from "@earendil-works/pi-tui";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import {
	buildIntentContext,
	buildInstructions as makeBuildInstructions,
	editInstructions as makeEditInstructions,
	isForeignPlanPath,
	planInstructions as makePlanInstructions,
	planObjectiveFromText,
	plansDirectory,
	readIntent,
	recordVerificationCommand,
	resolvePlanIntent,
	shellCommandFromInput,
	validatePlan,
	verificationCommandsFromText,
	type IntentKind,
	type IntentState,
} from "./logic.ts";

const PLANS_DIR = plansDirectory(getAgentDir());
const STATE_ENTRY = "plan-state";
const INTENT_TIMEOUT_MS = 10_000;
const CLASSIFIER_PROVIDER = "typesafe";
const CLASSIFIER_MODEL_ID = "jev-latest";

type Phase = "planning" | "executing" | "done";

interface PlanState {
	sessionId: string;
	planPath: string;
	phase: Phase;
	widgetVisible: boolean;
	activeTask?: string;
	requiredVerificationCommands?: string[];
	verifiedCommands?: string[];
	verificationNudged?: boolean;
}

interface TodoItem {
	status: string;
	id?: string;
	content?: string;
	title?: string;
}

interface TodoDetails {
	todos?: TodoItem[];
}

let state: PlanState | null = null;

/** First free path for <plan-name>-<session-id>.md; collisions get -2, -3, ... */
function uniquePlanPath(planName: string, sessionId: string): string {
	const base = join(PLANS_DIR, `${planName}-${sessionId}`);
	let path = `${base}.md`;
	for (let i = 2; existsSync(path); i++) path = `${base}-${i}.md`;
	return path;
}

/** Matches `<name>-<sessionId>.md` and `<name>-<sessionId>-<n>.md`. */
function sessionSuffixMatch(name: string, sessionId: string): boolean {
	return new RegExp(`-${sessionId}(?:-\\d+)?\\.md$`).test(name);
}

/** Path of the newest of the given plan file names. */
function newestOf(names: string[]): string | null {
	if (names.length === 0) return null;
	let best = names[0];
	let bestTime = 0;
	for (const name of names) {
		try {
			const info = statSync(join(PLANS_DIR, name));
			if (info.mtimeMs > bestTime) {
				best = name;
				bestTime = info.mtimeMs;
			}
		} catch {
			// Skip files deleted between readdir and stat.
		}
	}
	return join(PLANS_DIR, best);
}

function planFiles(): string[] {
	try {
		return readdirSync(PLANS_DIR).filter((name) => name.endsWith(".md"));
	} catch {
		return [];
	}
}

function newestForSession(sessionId: string): string | null {
	const files = planFiles().filter((name) => sessionSuffixMatch(name, sessionId));
	return files.length ? newestOf(files) : null;
}

/** True while any todo is not completed or cancelled; empty list means not built yet. */
function listHasWork(todos: Array<{ status: string }> | undefined): boolean {
	if (!todos || todos.length === 0) return true;
	return todos.some((todo) => todo.status !== "completed" && todo.status !== "cancelled");
}

/** Read the current write-todos list from the session branch. */
function currentTodos(ctx: ExtensionContext): TodoItem[] | undefined {
	let todos: TodoItem[] | undefined;
	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type !== "message") continue;
		const msg = entry.message;
		if (msg.role !== "toolResult" || msg.toolName !== "write-todos") continue;
		const details = msg.details as TodoDetails | undefined;
		if (details?.todos) todos = details.todos;
	}
	return todos;
}

function verificationComplete(plan: PlanState | null): boolean {
	const expected = plan?.requiredVerificationCommands ?? [];
	const verified = plan?.verifiedCommands ?? [];
	return expected.length > 0 && expected.every((command) => verified.includes(command));
}

/** The gating directive appended to the system prompt while work remains. */
function gateBlock(planPath: string, activeTask: string | undefined): string {
	return [
		"ACTIVE PLAN (GATED)",
		`Path: ${planPath}`,
		`Active task: ${activeTask ?? "No task is marked in progress. Select the next plan task."}`,
		"This session is bound to this plan. Read the file before changing code. Work only within its Scope Boundaries and Technical Approach. Do not start unrelated work.",
		"Do not modify unrelated files or begin follow-up work after the plan tasks finish.",
		"Before reporting completion, apply skill:verification-before-completion. Run every listed Verification Command after the latest change. Inspect the full output and paste it. The plan stays open until every listed command succeeds.",
	].join("\n");
}

const STOPWORDS = new Set(["a", "an", "the", "to", "for", "of", "with", "and", "or", "in", "on"]);

/** Slug from a plan title: up to 4 content words, hyphenated, capped per word. */
function synthesizePlanName(title: string): string {
	const words = title
		.toLowerCase()
		.replace(/[^a-z0-9\s]+/g, " ")
		.split(/\s+/)
		.filter((word) => word && !STOPWORDS.has(word))
		.slice(0, 4)
		.map((word) => word.slice(0, 20));
	return words.length ? words.join("-") : "plan";
}

/** First H1 title text, preferring the "# Plan: <title>" form. */
function planTitleFromText(text: string): string | null {
	const match = /^#[ \t]+Plan:[ \t]*(.+)$/m.exec(text) ?? /^#[ \t]+(.+)$/m.exec(text);
	return match?.[1]?.trim() || null;
}

/** Rebuild state from the session branch's plan-state custom entry. */
function reconstructState(ctx: ExtensionContext): void {
	state = null;
	const sessionId = ctx.sessionManager.getSessionId();
	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type !== "custom" || entry.customType !== STATE_ENTRY) continue;
		const data = entry.data as PlanState | undefined;
		if (data && data.sessionId === sessionId) {
			state = { ...data, widgetVisible: data.widgetVisible !== false };
		}
	}
}

/** Show the Current Plan widget while a plan is active and visibility is on. */
function syncWidget(ctx: ExtensionContext): void {
	if (state && state.phase !== "done" && state.widgetVisible) {
		ctx.ui.setWidget("plan", [
			ctx.ui.theme.fg("accent", `Current Plan: ${basename(state.planPath)}`),
			ctx.ui.theme.fg("muted", "/plan show to toggle"),
		]);
	} else {
		ctx.ui.setWidget("plan", undefined);
	}
}

export default function (pi: ExtensionAPI): void {
	const shellCommandByCallId = new Map<string, string | null>();

	// Marker entry carrying {sessionId, planPath, phase, widgetVisible}; set by
	// the command and the event handlers.
	const persistState = (): void => {
		if (state) pi.appendEntry(STATE_ENTRY, state);
	};

	/** The recorded plan when its file exists, else the newest plan for the session. */
	const resolveActivePath = (sessionId: string): string | null =>
		state && state.sessionId === sessionId && existsSync(state.planPath)
			? state.planPath
			: newestForSession(sessionId);

	/** Ask the classifier for the intent. Returns null on a missing model, failure, or timeout. */
	const classifyIntent = async (ctx: ExtensionContext, request: string, sessionId: string): Promise<IntentKind | null> => {
		const model = ctx.modelRegistry.findOfType("classifier", CLASSIFIER_PROVIDER, CLASSIFIER_MODEL_ID);
		if (!model) return null;
		const planPath = resolveActivePath(sessionId);
		let title: string | null = null;
		let objective: string | null = null;
		if (planPath) {
			try {
				const text = readFileSync(planPath, "utf8");
				title = planTitleFromText(text);
				objective = planObjectiveFromText(text);
			} catch {
				// Unreadable plan: classify without a title or objective.
			}
		}
		const intentState: IntentState = {
			request,
			hasActivePlan: planPath !== null,
			activePlanPath: planPath,
			activePlanTitle: title,
			activePlanObjective: objective,
			activePlanPhase: state?.sessionId === sessionId ? state.phase : null,
		};
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), INTENT_TIMEOUT_MS);
		const forwardAbort = (): void => controller.abort();
		ctx.signal?.addEventListener("abort", forwardAbort, { once: true });
		try {
			const result = await ctx.modelRegistry.classify(model, buildIntentContext(intentState), { signal: controller.signal });
			return readIntent(result);
		} catch {
			return null;
		} finally {
			clearTimeout(timer);
			ctx.signal?.removeEventListener("abort", forwardAbort);
		}
	};

	/** Start a new plan. The file name is fixed now, so it never changes later. */
	const createPlan = (ctx: ExtensionContext, sessionId: string, objective: string): void => {
		const planPath = uniquePlanPath(synthesizePlanName(objective), sessionId);
		state = { sessionId, planPath, phase: "planning", widgetVisible: state?.widgetVisible ?? true };
		persistState();
		syncWidget(ctx);
		ctx.ui.notify(`Plan target: ${planPath}`, "info");
		pi.sendUserMessage(makePlanInstructions(planPath, objective));
	};

	/** Change the active plan in place. */
	const editPlan = (ctx: ExtensionContext, sessionId: string, request: string): void => {
		const planPath = resolveActivePath(sessionId);
		if (!planPath) {
			ctx.ui.notify("No plan found. Run /plan <objective> first.", "error");
			return;
		}
		state = { sessionId, planPath, phase: "planning", widgetVisible: state?.widgetVisible ?? true };
		persistState();
		syncWidget(ctx);
		ctx.ui.notify(`Editing plan: ${planPath}`, "info");
		pi.sendUserMessage(makeEditInstructions(planPath, request));
	};

	/** Execute the active plan. */
	const buildPlan = (ctx: ExtensionContext, sessionId: string): void => {
		const planPath = resolveActivePath(sessionId);
		if (!planPath) {
			ctx.ui.notify("No plan found. Run /plan <objective> first.", "error");
			return;
		}
		let requiredVerificationCommands: string[] = [];
		try {
			requiredVerificationCommands = verificationCommandsFromText(readFileSync(planPath, "utf8"));
		} catch {
			// The verification gate remains closed when the plan cannot be read.
		}
		state = {
			sessionId,
			planPath,
			phase: "executing",
			widgetVisible: state?.widgetVisible ?? true,
			activeTask: undefined,
			requiredVerificationCommands,
			verifiedCommands: [],
			verificationNudged: false,
		};
		persistState();
		syncWidget(ctx);
		ctx.ui.notify(`Building: ${planPath}`, "info");
		pi.sendUserMessage(makeBuildInstructions(planPath));
	};

	pi.registerCommand("plan", {
		description: "Plan workflow: <request> to create or edit, 'build' to execute, 'validate' to check, 'show' to toggle",
		getArgumentCompletions: (prefix: string): AutocompleteItem[] | null => {
			const p = prefix.trim().toLowerCase();
			const matches = ["build", "show", "validate"].filter((option) => option.startsWith(p));
			return matches.length ? matches.map((value) => ({ value, label: value })) : null;
		},
		handler: async (args, ctx) => {
			const raw = args.trim();
			const sessionId = ctx.sessionManager.getSessionId();

			// /plan show — toggle the Current Plan widget. Pure UI: no agent
			// run is dispatched, so it must work while the agent is busy.
			if (raw === "show") {
				if (!state || state.sessionId !== sessionId || state.phase === "done") {
					ctx.ui.notify("No active plan. Run /plan <objective> first.", "warning");
					return;
				}
				state.widgetVisible = !state.widgetVisible;
				persistState();
				syncWidget(ctx);
				ctx.ui.notify(state.widgetVisible ? "Plan widget shown" : "Plan widget hidden", "info");
				return;
			}

			// /plan validate — structural check, no agent run.
			if (raw === "validate") {
				const activePath = resolveActivePath(sessionId);
				if (!activePath) {
					ctx.ui.notify("No plan found. Run /plan <objective> first.", "error");
					return;
				}
				let text: string;
				try { text = readFileSync(activePath, "utf8"); } catch { ctx.ui.notify(`Cannot read plan: ${activePath}`, "error"); return; }
				const result = validatePlan(text);
				ctx.ui.notify(result.valid ? `Plan valid: ${activePath}` : `Plan invalid: ${result.errors.join(" ")}`, result.valid ? "info" : "error");
				return;
			}

			// The remaining forms dispatch an agent run; they need an idle session.
			if (!ctx.isIdle()) {
				ctx.ui.notify("The agent is busy. /plan needs an idle session.", "warning");
				return;
			}

			// /plan build — execute the active plan. Kept as an exact keyword.
			if (raw === "build") {
				buildPlan(ctx, sessionId);
				return;
			}

			let request = raw;
			if (!request && ctx.hasUI) {
				request = (await ctx.ui.input("Plan request", "e.g. Add a plugin system"))?.trim() ?? "";
			}
			if (!request) {
				ctx.ui.notify("Usage: /plan <request> | build | show | validate", "warning");
				return;
			}

			// No plan yet: create directly. Never spend a classifier call.
			if (resolveActivePath(sessionId) === null) {
				createPlan(ctx, sessionId, request);
				return;
			}

			const hasActivePlan = resolveActivePath(sessionId) !== null;
			const intent = resolvePlanIntent(
				{ request, hasActivePlan },
				await classifyIntent(ctx, request, sessionId),
			);
			if (intent === "build") {
				buildPlan(ctx, sessionId);
			} else if (intent === "edit") {
				editPlan(ctx, sessionId, request);
			} else {
				createPlan(ctx, sessionId, request);
			}
		},
	});

	// Gate: bind the agent to the active plan while executing and work remains.
	pi.on("before_agent_start", async (event, ctx) => {
		if (!state || state.sessionId !== ctx.sessionManager.getSessionId()) return;
		if (state.phase !== "executing") return;
		if (!listHasWork(currentTodos(ctx)) && verificationComplete(state)) {
			state.phase = "done";
			persistState();
			syncWidget(ctx);
			return;
		}
		return {
			systemPrompt: `${event.systemPrompt ?? ""}\n\n${gateBlock(state.planPath, state.activeTask)}`,
		};
	});

	// Guard: while a plan is active, block writes to any other plan file.
	pi.on("tool_call", async (event, ctx) => {
		if (!state || state.sessionId !== ctx.sessionManager.getSessionId()) return;
		if (state.phase === "done") return;
		if (event.toolName === "bash" || event.toolName === "powershell") {
			if (state.phase === "executing") shellCommandByCallId.set(event.toolCallId, shellCommandFromInput(event.input));
			return;
		}
		if (event.toolName !== "write" && event.toolName !== "edit") return;
		const target = (event.input as { path?: unknown }).path;
		if (typeof target !== "string") return;
		if (!isForeignPlanPath(target, PLANS_DIR, state.planPath)) return;
		return { block: true, reason: `Active plan is ${state.planPath}. Edit that file. Do not create another plan file.` };
	});

	// Verification + completion: record exact listed commands after edits, and
	// flip to "done" only when every todo and every verification command is complete.
	pi.on("tool_execution_end", async (event, ctx) => {
		if (!state || state.sessionId !== ctx.sessionManager.getSessionId()) return;
		if (state.phase !== "executing") return;
		if (event.toolName === "edit" || event.toolName === "write") {
			if (!event.isError) {
				state.verifiedCommands = [];
				persistState();
			}
			return;
		}
		if (event.toolName === "bash" || event.toolName === "powershell") {
			const command = shellCommandByCallId.get(event.toolCallId) ?? null;
			shellCommandByCallId.delete(event.toolCallId);
			state.verifiedCommands = recordVerificationCommand(
				state.verifiedCommands ?? [],
				command,
				state.requiredVerificationCommands ?? [],
				Boolean(event.isError),
			);
			persistState();
			return;
		}
		if (event.toolName !== "write-todos") return;
		const result = event.result as { details?: TodoDetails } | undefined;
		const todos = result?.details?.todos;
		if (!todos) return;
		const active = todos.find((todo) => todo.status === "in_progress");
		state.activeTask = active?.content ?? active?.title ?? active?.id;
		if (!listHasWork(todos) && verificationComplete(state)) state.phase = "done";
		persistState();
		syncWidget(ctx);
	});

	// Verification nudge: when every todo is done but listed verification is
	// incomplete, force one more turn to run and inspect the commands.
	pi.on("agent_before_settle", async (_event, ctx) => {
		if (!state || state.sessionId !== ctx.sessionManager.getSessionId()) return;
		if (state.phase !== "executing") return;
		if (listHasWork(currentTodos(ctx))) return;
		if (verificationComplete(state)) {
			state.phase = "done";
			persistState();
			syncWidget(ctx);
			return;
		}
		if (state.verificationNudged) return;
		state.verificationNudged = true;
		persistState();
		syncWidget(ctx);
		return {
			continue: true,
			entries: [{
				type: "custom_message",
				customType: "plan-verify-required",
				display: true,
				content: "All plan tasks are complete, but one or more listed Verification Commands have not succeeded since the latest change. Apply skill:verification-before-completion. Run every listed command, inspect the full output, paste it, then stop.",
			}],
		};
	});

	// Rebuild state on load, switch, and tree navigate.
	const rebuild = (_event: unknown, ctx: ExtensionContext): void => {
		reconstructState(ctx);
		syncWidget(ctx);
	};
	pi.on("session_start", rebuild);
	pi.on("session_tree", rebuild);
}