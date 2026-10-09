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
 * When the last todo completes or is cancelled, phase flips to "done" and the
 * gate and widget drop.
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
	fallbackIntent,
	hasVerificationEvidence,
	isForeignPlanPath,
	planObjectiveFromText,
	plansDirectory,
	readIntent,
	validatePlan,
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
	buildStartedAt?: number;
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

/** Live evidence flag: a successful command ran after the last code change. */
let evidenceRan = false;

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

/** True when a successful command follows the last code change since build start. */
function verificationEvidenceFromBranch(ctx: ExtensionContext, buildStartedAt: number | undefined): boolean {
	if (!buildStartedAt) return false;
	const items: Array<{ role: string; toolName?: string; isError?: boolean }> = [];
	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type !== "message") continue;
		if (Date.parse(entry.timestamp) < buildStartedAt) continue;
		const msg = entry.message;
		if (msg.role !== "toolResult") continue;
		items.push({ role: msg.role, toolName: msg.toolName, isError: msg.isError });
	}
	return hasVerificationEvidence(items);
}

/** The gating directive appended to the system prompt while work remains. */
function gateBlock(planPath: string, activeTask: string | undefined): string {
	return [
		"ACTIVE PLAN (GATED)",
		`Path: ${planPath}`,
		`Active task: ${activeTask ?? "No task is marked in progress. Select the next plan task."}`,
		"This session is bound to this plan. Read the file before changing code. Work only within its Scope Boundaries and Technical Approach. Do not start unrelated work.",
		"Do not modify unrelated files or begin follow-up work after the plan tasks finish.",
		"Before reporting completion, apply the verification-before-completion skill: run the plan's Verification Commands and paste the raw output. The plan stays open until a command has run successfully since the last code change.",
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

const PLAN_STRUCTURE = `# Plan: <brief action title>

### Overview
1-2 sentences: core objective, technical mechanism, expected outcome.

### Context & Baseline
- **Current State:** relevant existing code, interfaces, or constraints found during inspection.
- **Key Invariants:** behaviors or architectural contracts that must stay unbroken.

### Scope Boundaries
- **In-Scope:** concrete capabilities, behaviors, and files targeted in this run.
- **Out-of-Scope / Non-Goals:** features deliberately deferred and areas forbidden from modification.

### Affected Files & Components
- \`path/to/file.ext\` — [MODIFY]: specific functions, types, or imports to alter.
- \`path/to/new_file.ext\` — [CREATE]: responsibility and exports.
- \`path/to/deprecated_file.ext\` — [DELETE]: reason for removal.

### Technical Approach & Architecture
Step-by-step implementation logic: data structures, state transitions, API changes, integration points. Add a mermaid diagram only when the data flow is non-trivial.

### Interfaces & Dependencies
- **Interfaces:** inputs, outputs, events, and compatibility contracts that change or must remain stable.
- **Dependencies:** packages, modules, services, and integration points required by the implementation.

### Verification & Acceptance Criteria
- **Acceptance Criteria:** observable behaviors that must hold.
- **Verification Commands:** exact commands to run, for example \`pytest tests/test_feature.py -k test_name\` or \`cargo check\`.

### Global Constraints
- Preserve existing naming, resolution order, command semantics, and user-visible behavior unless this plan explicitly changes them.
- Keep all changes within the Scope Boundaries. Do not add speculative abstractions.

### Execution Todos
Ordered, trackable milestones. Each item must be a discrete, verifiable state:
- [ ] Task 1: <setup / interface scaffolding>
- [ ] Task 2: <core business logic>
- [ ] Task 3: <integration and glue code>
- [ ] Task 4: <run the exact verification commands and check acceptance criteria>

The final task must run verification commands and confirm acceptance criteria. Keep 3-8 tasks. Each task must be small enough to finish in one agent turn.`;

function planInstructions(planPath: string, objective: string): string {
	return `You are in PLAN MODE. Create an execution plan for: ${objective}

The plan file is: ${planPath}

Write the plan into that exact path with the write tool. The write tool creates parent directories. This path is final; the extension never renames the file. To update the plan later, edit this same path.

The plan must start with an H1 title on the first line, in the form "# Plan: <title>", where <title> is a concise 3-4 word summary of the plan (for example "# Plan: Add Click Burst Feature"). The title is display text only; the file name comes from the objective.

Operational rules:
1. Read before writing. Inspect the relevant architecture, imports, and utilities. Reuse existing patterns; do not reinvent utilities.
2. Commit to one solution. Never present open-ended alternatives (no "Option A vs B", no "TBD"). Make the technical choice and justify it in one sentence.
3. Guard against over-engineering. Implement only what the task requires. No speculative abstractions or unused helpers.
4. No markdown tables. Use lists, code blocks, or bold key-value pairs.
5. Delegate research. For codebase recon or external facts, spawn the explorer or surface-researcher subagent and use its condensed report. Do not bloat your context.
6. Ask one targeted question only when a fact changes the plan's shape. Decide everything else.

Write the file with exactly this structure:

${PLAN_STRUCTURE}

Do NOT touch write-todos. /plan build loads the Execution Todos later.`;
}

/** First H1 title text, preferring the "# Plan: <title>" form. */
function planTitleFromText(text: string): string | null {
	const match = /^#[ \t]+Plan:[ \t]*(.+)$/m.exec(text) ?? /^#[ \t]+(.+)$/m.exec(text);
	return match?.[1]?.trim() || null;
}

function editInstructions(planPath: string, request: string): string {
	return `You are in PLAN-EDIT MODE. Update the existing plan for this request: ${request}

The plan file is: ${planPath}

Rules:
1. Read the file fully before changing it.
2. Change it in place with the edit tool. Do not create a new file and do not rename it.
3. Keep the H1 title and every required section. Update only what the request needs.
4. Keep the file valid: non-empty required sections, exact file paths in backticks, Verification Commands present, and checkbox tasks in the Execution Todos.
5. Do not touch write-todos.

When done, report the plan path and a one-line summary of what changed.`;
}

function buildInstructions(planPath: string): string {
	return `You are in PLAN-BUILD MODE. Implement the active plan:

${planPath}

1. Read the plan file fully before changing any code.
2. Parse its Execution Todos. In ONE write-todos call, load them: ids todo-1..todo-N, status pending. write-todos replaces the entire list, so every previous todo is wiped.
3. Implement the tasks in order. Keep exactly one todo in_progress at a time.
4. Follow Scope Boundaries strictly. Never modify out-of-scope files. Follow Technical Approach; run the Verification Commands.
5. As each task lands, call write-todos with the FULL current list, marking that task completed. A partial list removes the todos you omit.
6. When every todo is completed or cancelled, stop. Report what changed, the verification results, and the plan path. Do not continue into new work.`;
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
		pi.sendUserMessage(planInstructions(planPath, objective));
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
		pi.sendUserMessage(editInstructions(planPath, request));
	};

	/** Execute the active plan. */
	const buildPlan = (ctx: ExtensionContext, sessionId: string): void => {
		const planPath = resolveActivePath(sessionId);
		if (!planPath) {
			ctx.ui.notify("No plan found. Run /plan <objective> first.", "error");
			return;
		}
		evidenceRan = false;
		state = { sessionId, planPath, phase: "executing", widgetVisible: state?.widgetVisible ?? true, activeTask: undefined, buildStartedAt: Date.now(), verificationNudged: false };
		persistState();
		syncWidget(ctx);
		ctx.ui.notify(`Building: ${planPath}`, "info");
		pi.sendUserMessage(buildInstructions(planPath));
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

			const intent = (await classifyIntent(ctx, request, sessionId))
				?? fallbackIntent({ hasActivePlan: resolveActivePath(sessionId) !== null });
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
		if (!listHasWork(currentTodos(ctx)) && evidenceRan) {
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
		if (event.toolName !== "write" && event.toolName !== "edit") return;
		const target = (event.input as { path?: unknown }).path;
		if (typeof target !== "string") return;
		if (!isForeignPlanPath(target, PLANS_DIR, state.planPath)) return;
		return { block: true, reason: `Active plan is ${state.planPath}. Edit that file. Do not create another plan file.` };
	});

	// Evidence + completion: track commands after edits, and flip to "done"
	// only when every todo is finished and a command ran since the last change.
	pi.on("tool_execution_end", async (event, ctx) => {
		if (!state || state.sessionId !== ctx.sessionManager.getSessionId()) return;
		if (state.phase !== "executing") return;
		if (event.toolName === "edit" || event.toolName === "write") {
			if (!event.isError) evidenceRan = false;
			return;
		}
		if (event.toolName === "bash" || event.toolName === "powershell") {
			if (!event.isError) evidenceRan = true;
			return;
		}
		if (event.toolName !== "write-todos") return;
		const result = event.result as { details?: TodoDetails } | undefined;
		const todos = result?.details?.todos;
		if (!todos) return;
		const active = todos.find((todo) => todo.status === "in_progress");
		state.activeTask = active?.content ?? active?.title ?? active?.id;
		if (!listHasWork(todos) && evidenceRan) state.phase = "done";
		persistState();
		syncWidget(ctx);
	});

	// Verification nudge: when every todo is done but no command has run since
	// the last code change, force exactly one more turn to verify.
	pi.on("agent_before_settle", async (_event, ctx) => {
		if (!state || state.sessionId !== ctx.sessionManager.getSessionId()) return;
		if (state.phase !== "executing") return;
		if (listHasWork(currentTodos(ctx))) return;
		if (evidenceRan) {
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
				content: "All plan tasks are complete, but no command has run successfully since the last code change. Apply the verification-before-completion skill now: run the plan's Verification Commands and paste the raw output. Then stop.",
			}],
		};
	});

	// Rebuild state on load, switch, and tree navigate.
	const rebuild = (_event: unknown, ctx: ExtensionContext): void => {
		reconstructState(ctx);
		evidenceRan = verificationEvidenceFromBranch(ctx, state?.buildStartedAt);
		syncWidget(ctx);
	};
	pi.on("session_start", rebuild);
	pi.on("session_tree", rebuild);
}