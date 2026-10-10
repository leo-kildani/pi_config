import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { ClassifierContext, ClassifierResult } from "@earendil-works/pi-ai";

export interface PlanValidation {
	valid: boolean;
	errors: string[];
}

/** Resolve the plans directory inside Pi's configured agent directory. */
export function plansDirectory(agentDir: string): string {
	return join(agentDir, "plans");
}

/** The active plan path. A completed plan is not active. */
export function activePlanPath(
	recorded: { sessionId: string; planPath: string; phase: string } | null,
	sessionId: string,
	fileExists: boolean,
	newest: string | null,
): string | null {
	if (!recorded || recorded.sessionId !== sessionId) return newest;
	if (recorded.phase === "done") return null;
	return fileExists ? recorded.planPath : newest;
}

/** Minimal shape of a recorded tool result used by the verification gate. */
export interface ToolResultLike {
	role: string;
	toolName?: string;
	command?: string;
	isError?: boolean;
}

const MUTATION_TOOLS = new Set(["edit", "write"]);
const EVIDENCE_TOOLS = new Set(["bash", "powershell"]);

const REQUIRED_HEADINGS = [
	"Overview",
	"Test-Driven Development",
	"Context & Baseline",
	"Scope Boundaries",
	"Affected Files & Components",
	"Technical Approach & Architecture",
	"Interfaces & Dependencies",
	"Verification & Acceptance Criteria",
	"Global Constraints",
	"Execution Todos",
] as const;

function sectionBody(text: string, heading: string): string {
	const headings = [...text.matchAll(/^###\s+(.+?)\s*$/gm)];
	const current = headings.find((match) => match[1] === heading);
	if (!current || current.index === undefined) return "";
	const next = headings.find((match) => (match.index ?? 0) > current.index!);
	return text.slice(current.index + current[0].length, next?.index ?? text.length).trim();
}

/** Overview body of a plan as one line, or null when absent or empty. */
export function planObjectiveFromText(text: string): string | null {
	const body = sectionBody(text, "Overview");
	if (!body) return null;
	return body.replace(/\s+/g, " ").trim() || null;
}

/** Read inline commands from the Verification Commands section. */
export function verificationCommandsFromText(text: string): string[] {
	const body = sectionBody(text, "Verification & Acceptance Criteria");
	return [...body.matchAll(/`([^`]+)`/g)].map((match) => match[1].trim()).filter(Boolean);
}

/** Extract the command field used by the bash and powershell tools. */
export function shellCommandFromInput(input: unknown): string | null {
	if (typeof input === "string") return input.trim() || null;
	if (typeof input !== "object" || input === null || !("command" in input)) return null;
	const command = (input as { command?: unknown }).command;
	return typeof command === "string" ? command.trim() || null : null;
}

/** Add one successful plan command, or clear evidence when a command fails or is unrelated. */
export function recordVerificationCommand(
	completed: string[],
	command: string | null,
	expected: string[],
	failed = false,
): string[] {
	if (!command || failed || !expected.includes(command)) return [];
	return [...new Set([...completed, command])];
}

/** True when every listed command succeeds after the last successful mutation. */
export function hasVerificationEvidence(entries: ToolResultLike[], expected: string[]): boolean {
	if (expected.length === 0) return false;
	let completed: string[] = [];
	for (const entry of entries) {
		if (entry.role !== "toolResult") continue;
		if (entry.toolName && MUTATION_TOOLS.has(entry.toolName)) {
			if (!entry.isError) completed = [];
			continue;
		}
		if (entry.toolName && EVIDENCE_TOOLS.has(entry.toolName)) {
			completed = recordVerificationCommand(completed, entry.command ?? null, expected, entry.isError ?? false);
		}
	}
	return expected.every((command) => completed.includes(command));
}

export function validatePlan(text: string): PlanValidation {
	const errors: string[] = [];
	const title = /^# Plan:[ \t]*([^\r\n]+)(?:\r?\n|$)/.exec(text)?.[1]?.trim();
	if (!title) {
		errors.push("First line must be an H1 in the form '# Plan: <title>'.");
	} else {
		const wordCount = title.split(/\s+/).length;
		if (wordCount < 3 || wordCount > 4) errors.push("Plan title must use three or four words that name its capability.");
	}
	for (const heading of REQUIRED_HEADINGS) {
		const body = sectionBody(text, heading);
		if (!body) errors.push(`Missing or empty required section: ${heading}.`);
	}
	const files = sectionBody(text, "Affected Files & Components");
	if (files && !/`[^`]+`/.test(files)) errors.push("Affected Files & Components must list exact file paths in backticks.");
	const tdd = sectionBody(text, "Test-Driven Development");
	if (tdd) {
		const applicability = /^\s*-\s*\*\*Applicability:\*\*\s*(.+)$/im.exec(tdd)?.[1]?.trim();
		if (!applicability) {
			errors.push("Test-Driven Development must state whether TDD applies.");
		} else if (/^not applicable\b/i.test(applicability)) {
			if (!/^not applicable\s+(?:because\s+|:\s*)\S/i.test(applicability)) {
				errors.push("A not-applicable TDD statement must give a reason.");
			}
		} else if (!["RED", "GREEN", "REFACTOR"].every((phase) => new RegExp(`\\b${phase}\\b`, "i").test(tdd))) {
			errors.push("Applicable TDD work must define RED, GREEN, and REFACTOR phases.");
		}
	}
	const verification = sectionBody(text, "Verification & Acceptance Criteria");
	if (verification && !/Verification Commands/i.test(verification)) errors.push("Verification & Acceptance Criteria must include exact Verification Commands.");
	if (verification && verificationCommandsFromText(text).length === 0) errors.push("Verification Commands must list exact commands in backticks.");
	const todos = sectionBody(text, "Execution Todos");
	if (todos && !/^\s*- \[.\]\s+.+$/m.test(todos)) errors.push("Execution Todos must contain checkbox tasks in '- [ ] Task' format.");
	return { valid: errors.length === 0, errors };
}

const PLAN_STRUCTURE = `# Plan: <three- or four-word capability title>

### Overview
State the objective, expected outcome, and relevant context in 1-2 sentences.

### Test-Driven Development
- **Applicability:** Required or not applicable, with a reason.
- For testable work, list RED, GREEN, and REFACTOR steps before implementation.

### Context & Baseline
- **Current State:** relevant code and constraints.
- **Key Invariants:** behaviors and contracts that must stay unbroken.

### Scope Boundaries
- **In-Scope:** concrete capabilities and files.
- **Out-of-Scope / Non-Goals:** deferred work and forbidden areas.

### Affected Files & Components
- \`path/to/file.ext\` — [MODIFY]: functions, types, or imports to change.
- \`path/to/new_file.ext\` — [CREATE]: responsibility and exports.
- \`path/to/removed_file.ext\` — [DELETE]: reason for removal.

### Technical Approach & Architecture
List the implementation steps. Add a mermaid diagram only when data flow is non-trivial.

### Interfaces & Dependencies
- **Interfaces:** inputs, outputs, events, and compatibility contracts.
- **Dependencies:** packages, modules, services, and integration points.

### Verification & Acceptance Criteria
- **Acceptance Criteria:** observable behaviors.
- **Verification Commands:** exact commands to run.

### Global Constraints
- Preserve existing names, resolution order, command semantics, and user-visible behavior unless this plan changes them.
- Keep all changes within the Scope Boundaries. Do not add speculative abstractions.

### Execution Todos
Ordered, trackable milestones. Use 3-8 tasks. Each task must be discrete and verifiable.
The final task must run the exact Verification Commands and confirm the acceptance criteria.`;

export function planInstructions(planPath: string, objective: string): string {
	return `You are in PLAN MODE. Create an execution plan for: ${objective}

The plan file is: ${planPath}

Write the plan to this exact path with the write tool. This path is final. To edit the plan later, change this same file.

Use skill:writing-in-ste for the plan prose. Use active voice and direct sentences. Keep descriptive sentences to 25 words or fewer. Keep procedural sentences to 20 words or fewer.

Give the H1 a concise, capability-specific name of three or four words. Make the Overview state what the plan changes, its outcome, and the relevant context. Avoid vague names and descriptions.

For code or testable behavior, use skill:test-driven-development. Order each behavior as RED, GREEN, then REFACTOR. State when TDD does not apply and why.

Use write-todos to track plan-drafting tasks. It replaces the full list. Keep existing entries and pass the full current list on every call. Do not load the plan's Execution Todos until /plan build.

1. Read before writing. Inspect the relevant architecture, imports, and utilities. Reuse existing patterns.
2. Choose one solution. Do not list alternatives or TBD items. Give one short reason for the choice.
3. Implement only the requested work. Do not add speculative abstractions.
4. Do not use markdown tables.
5. Ask one targeted question only when a fact changes the plan's shape. Decide all other details.

Write the file with exactly this structure:

${PLAN_STRUCTURE}`;
}

export function editInstructions(planPath: string, request: string): string {
	return `You are in PLAN-EDIT MODE. Update the existing plan for: ${request}

The plan file is: ${planPath}

Read the full plan before editing. Keep its H1 title, required sections, exact file paths, Verification Commands, and checkbox tasks. Keep the title concise and capability-specific. Make the Overview state the objective and relevant context.

Use skill:writing-in-ste for plan prose. Use write-todos to track the plan-edit tasks. It replaces the full list. Keep existing entries and pass the full current list on every call. Do not load the plan's Execution Todos until /plan build.

For code or testable changes, use skill:test-driven-development. Order each behavior as RED, GREEN, then REFACTOR. State when TDD does not apply and why.

Change this file in place. Do not create or rename plan files. Report the path and a one-line summary when done.`;
}

export function buildInstructions(planPath: string): string {
	return `You are in PLAN-BUILD MODE. Implement the active plan:

${planPath}

1. Read the plan file fully before changing code.
2. Parse Execution Todos. In ONE write-todos call, load ids todo-1..todo-N with status pending. This replaces the full list.
3. Follow the plan's Test-Driven Development section. For testable work, run a failing test before production code. Then implement, verify, and refactor.
4. Implement tasks in order. Keep at most one todo in_progress.
5. Follow Scope Boundaries and Technical Approach. Run the Verification Commands.
6. After each task, call write-todos with the FULL current list and mark that task completed.
7. Keep the final todo for verification. Before reporting completion, apply skill:verification-before-completion. Run every listed Verification Command after the last change, inspect the full output, and paste the raw output.
8. When verification passes, stop. Report changes, verification results, and the plan path.`;
}

export type IntentKind = "create" | "edit" | "build";

export interface IntentState {
	request: string;
	hasActivePlan: boolean;
	activePlanPath: string | null;
	activePlanTitle: string | null;
	activePlanObjective: string | null;
	activePlanPhase: string | null;
}

const INTENT_KINDS: readonly string[] = ["create", "edit", "build"];

export function buildIntentContext(state: IntentState): ClassifierContext {
	return {
		state: {
			request: state.request,
			has_active_plan: state.hasActivePlan,
			active_plan_path: state.activePlanPath,
			active_plan_title: state.activePlanTitle,
			active_plan_objective: state.activePlanObjective,
			active_plan_phase: state.activePlanPhase,
		},
		questions: {
			intent: {
				type: "choice",
				instructions:
					"Choose the operator's plan action. Do not treat an active plan as evidence that the request is an edit. Compare the request with the active plan's objective.",
				criteria: {
					create: "The operator asks for a new or separate plan, or the request has a different objective.",
					edit: "The operator asks to refine, correct, or extend the active plan's objective.",
					build: "The operator asks to implement the active plan now.",
				},
			},
		},
	};
}

export function readIntent(result: ClassifierResult): IntentKind | null {
	if (result.stopReason !== "stop") return null;
	const answer = result.answers["intent"];
	if (answer?.type !== "choice") return null;
	return INTENT_KINDS.includes(answer.choice) ? (answer.choice as IntentKind) : null;
}

const NEW_PLAN_REQUEST = /\b(?:new|another|separate)\s+plan\b|\b(?:create|start|write|generate|draft)\s+(?:(?:a|an|another|new)\s+)?plan\b/i;

/** Choose an explicit new-plan request before the classifier result. */
export function resolvePlanIntent(
	state: Pick<IntentState, "request" | "hasActivePlan">,
	classifiedIntent: IntentKind | null,
): IntentKind {
	if (NEW_PLAN_REQUEST.test(state.request)) return "create";
	return classifiedIntent ?? fallbackIntent(state);
}

export function fallbackIntent(_state: Pick<IntentState, "hasActivePlan">): IntentKind {
	return "create";
}

/** True when target is a markdown file inside plansDir that is not the active plan. */
export function isForeignPlanPath(target: string, plansDir: string, activePath: string): boolean {
	if (!target) return false;
	const resolvedTarget = resolve(target);
	const rel = relative(resolve(plansDir), resolvedTarget);
	if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return false;
	if (!rel.endsWith(".md")) return false;
	return resolvedTarget !== resolve(activePath);
}
