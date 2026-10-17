import { join } from "node:path";

export type PlanPhase = "pending" | "built";

// Words that add no meaning to a plan file name. Anything else is kept.
const FILLER_WORDS = new Set([
	"a", "an", "the", "to", "for", "of", "with", "and", "or", "in", "on", "at", "by", "from", "as",
	"i", "we", "you", "me", "us", "my", "our", "your", "please", "can", "could", "would", "should",
	"will", "shall", "want", "need", "like", "help", "let", "that", "this", "these", "those", "it",
	"is", "are", "be", "do", "does", "did",
]);

/** Project plans directory: <cwd>/.plans. */
export function projectPlansDirectory(cwd: string): string {
	return join(cwd, ".plans");
}

/** Deterministic plan slug: the first three non-filler words of the objective. */
export function synthesizePlanName(objective: string): string {
	const words = objective
		.toLowerCase()
		.replace(/[^a-z0-9\s]+/g, " ")
		.split(/\s+/)
		.filter((word) => word && !FILLER_WORDS.has(word))
		.slice(0, 3)
		.map((word) => word.slice(0, 20));
	return words.length ? words.join("-") : "plan";
}

export function planFileName(name: string, sessionId: string): string {
	return `${name}-${sessionId}.md`;
}

/** Kebab slug of a plan name. Falls back to "plan" when no word remains. */
export function slugifyPlanName(name: string): string {
	const slug = name
		.toLowerCase()
		.replace(/[^a-z0-9\s]+/g, " ")
		.split(/\s+/)
		.filter(Boolean)
		.slice(0, 8)
		.join("-")
		.slice(0, 80);
	return slug || "plan";
}

export function planTemplateFileName(name: string): string {
	return `${slugifyPlanName(name)}.md`;
}

/** /plan <objective>: edit a pending plan, otherwise create a new one. */
export function planAction(phase: PlanPhase | null): "create" | "edit" {
	return phase === "pending" ? "edit" : "create";
}

/** /plan build: none when unset, already when built, otherwise build. */
export function buildAction(phase: PlanPhase | null): "none" | "already" | "build" {
	if (phase === "pending") return "build";
	return phase === "built" ? "already" : "none";
}

const PLAN_STRUCTURE = `# <Plan Name>

## Problem
Describe the current problem, task, or feature. State the relevant baseline and why the work is needed.

## Solution
Describe the chosen solution and the expected outcome. Include enough technical detail to guide implementation without listing execution steps here.

## Scope
Define the working environment and the boundaries for this work. State important constraints and what must remain unchanged.

### Variables
List repeated paths, environment names, configuration values, or other values that must stay consistent. Use exact values when known. Write \`None\` if there are no repeated variables.

### Files Affected
List the exact files to create, modify, or delete, with each file's action and intended change. Include only files, not general components. Write \`None\` if no files are affected.

- \`path/to/file.ext\` — [MODIFY]: Specify functions, types, or imports to change.
- \`path/to/new_file.ext\` — [CREATE]: Specify responsibilities and exports.
- \`path/to/deprecated_file.ext\` — [DELETE]: State the reason for removal.

## Workflows
Planning is complete. List one section per workflow. Each workflow has one execution list of build and verify tasks. Add only the workflows the plan needs.

### <Workflow Name>
- [ ] Build: <First implementation task.>
- [ ] Verify: <Run an exact verification command and check its expected result.>

## Definition of Done
List concrete, observable checklist items that prove the work is complete. Add task-specific subsections when needed. Include expected outcomes and exact verification commands where relevant.

- [ ] <Observable result is correct.>
- [ ] <Relevant checks pass.>

## How You're Graded
Give a concise rubric that states what the operator expects. Focus on correctness, scope, completed Definition of Done items, and honest verification results.`;

export function planTemplate(): string {
	return PLAN_STRUCTURE;
}

export function planInstructions(planPath: string, objective: string): string {
	return `You are in PLAN MODE. Create an execution plan for: ${objective}

Write the plan to this exact path with the write tool: ${planPath}
This path is final. Use it again for later edits.

Inspect the relevant code before you write. Choose one solution. Keep every change inside the Scope. Use skill:writing-in-ste for the plan prose.

Write the file with exactly this structure:

${planTemplate()}`;
}

export function editInstructions(planPath: string, objective: string): string {
	return `You are in PLAN-EDIT MODE. Update the existing plan for: ${objective}

Read the full plan first. Then change this file in place: ${planPath}

Keep the template sections and the file name. Do not create or rename plan files. Change only what the request needs. Use skill:writing-in-ste for the plan prose.`;
}

export function buildInstructions(planPath: string): string {
	return `You are in PLAN-BUILD MODE. Implement this plan: ${planPath}

1. Read the plan file fully before you change code.
2. Follow the Workflows in order. For each workflow, complete its Build tasks, then its Verify tasks. Keep at most one task in progress.
3. Before execution tracking, check whether a todo-tracking tool is available. Use it if available, such as \`tools:write-todos\` or an equivalent.
4. When you use a todo-tracking tool, create one todo for each Workflow task and pass the full list as task statuses change. Do not update task checkboxes in the plan file.
5. If no todo-tracking tool is available, update Workflow task checkboxes in the plan file as each task finishes.
6. Stay inside the Scope.
7. Complete the Verify tasks after the last change. Run the plan's verification commands and inspect the full output.
8. Stop when every applicable Definition of Done item passes. Report any failures or blockers honestly.`;
}
