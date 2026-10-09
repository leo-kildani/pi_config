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

/** Minimal shape of a recorded tool result used by the verification gate. */
export interface ToolResultLike {
	role: string;
	toolName?: string;
	isError?: boolean;
}

const MUTATION_TOOLS = new Set(["edit", "write"]);
const EVIDENCE_TOOLS = new Set(["bash", "powershell"]);

const REQUIRED_HEADINGS = [
	"Overview",
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

/**
 * True when a successful command ran after the last successful code change.
 * A failed command or failed edit does not count as evidence.
 */
export function hasVerificationEvidence(entries: ToolResultLike[]): boolean {
	let lastMutation = -1;
	let lastEvidence = -1;
	entries.forEach((entry, index) => {
		if (entry.role !== "toolResult" || entry.isError) return;
		if (entry.toolName && MUTATION_TOOLS.has(entry.toolName)) lastMutation = index;
		if (entry.toolName && EVIDENCE_TOOLS.has(entry.toolName)) lastEvidence = index;
	});
	return lastEvidence > lastMutation;
}

export function validatePlan(text: string): PlanValidation {
	const errors: string[] = [];
	if (!/^#\s+Plan:\s*\S/m.test(text)) errors.push("First line must be an H1 in the form '# Plan: <title>'.");
	for (const heading of REQUIRED_HEADINGS) {
		const body = sectionBody(text, heading);
		if (!body) errors.push(`Missing or empty required section: ${heading}.`);
	}
	const files = sectionBody(text, "Affected Files & Components");
	if (files && !/`[^`]+`/.test(files)) errors.push("Affected Files & Components must list exact file paths in backticks.");
	const verification = sectionBody(text, "Verification & Acceptance Criteria");
	if (verification && !/Verification Commands/i.test(verification)) errors.push("Verification & Acceptance Criteria must include exact Verification Commands.");
	const todos = sectionBody(text, "Execution Todos");
	if (todos && !/^\s*- \[.\]\s+.+$/m.test(todos)) errors.push("Execution Todos must contain checkbox tasks in '- [ ] Task' format.");
	return { valid: errors.length === 0, errors };
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
					"Decide what the operator wants to do with plans. An active plan existing does not make the request an edit. Compare the request against the active plan's objective and choose exactly one.",
				criteria: {
					create: "The request has an objective different from the active plan's objective. Start a separate plan.",
					edit: "The request refines, corrects, or extends the active plan's existing objective.",
					build: "The request asks to implement the active plan now.",
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

export function fallbackIntent(state: Pick<IntentState, "hasActivePlan">): IntentKind {
	return state.hasActivePlan ? "edit" : "create";
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
