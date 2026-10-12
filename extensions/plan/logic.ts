import { join } from "node:path";

export type PlanPhase = "pending" | "built";

// Words that add no meaning to a plan file name. Anything else is kept.
const FILLER_WORDS = new Set([
	"a", "an", "the", "to", "for", "of", "with", "and", "or", "in", "on", "at", "by", "from", "as",
	"i", "we", "you", "me", "us", "my", "our", "your", "please", "can", "could", "would", "should",
	"will", "shall", "want", "need", "like", "help", "let", "that", "this", "these", "those", "it",
	"is", "are", "be", "do", "does", "did",
]);

export function plansDirectory(agentDir: string): string {
	return join(agentDir, "plans");
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

/** /plan <objective>: edit a pending plan, otherwise create a new one. */
export function planAction(phase: PlanPhase | null): "create" | "edit" {
	return phase === "pending" ? "edit" : "create";
}

/** /plan build: none when unset, already when built, otherwise build. */
export function buildAction(phase: PlanPhase | null): "none" | "already" | "build" {
	if (phase === "pending") return "build";
	return phase === "built" ? "already" : "none";
}

const PLAN_STRUCTURE = `# Plan: <Action Title>

### Overview
Write one or two sentences. State the main objective, technical mechanism, and expected outcome.

### Context and Baseline
- **Current State:** State existing code, interfaces, or constraints found during inspection.
- **Key Invariants:** State architectural rules that must not change.

### Scope Limits
- **In-Scope:** Specify capabilities, behaviors, and files targeted in this plan.
- **Out-of-Scope:** Specify deferred features and areas that you must not modify.

### Affected Files and Components
- \`path/to/file.ext\` — [MODIFY]: Specify functions, types, or imports to change.
- \`path/to/new_file.ext\` — [CREATE]: Specify responsibilities and exports.
- \`path/to/deprecated_file.ext\` — [DELETE]: State the reason for removal.

### Technical Approach and Architecture
Specify the step-by-step logic: data structures, state changes, API changes, and integration points. Add a Mermaid diagram only when data flow is complex.

### Interfaces and Dependencies
- **Interfaces:** Specify inputs, outputs, events, and compatibility rules that change or must stay constant.
- **Dependencies:** List packages, modules, services, and integration points needed for the work.

### Verification and Acceptance Criteria
- **Acceptance Criteria:** Specify observable behaviors that must pass.
- **Verification Commands:** Specify exact commands to run (for example: \`pytest tests/test_feature.py -k test_name\` or \`cargo check\`).

### Global Constraints
- Preserve existing names, resolution order, command syntax, and user behavior unless this plan explicitly changes them.
- Keep all changes within the Scope Limits.
- Do not add speculative abstractions.

### Execution Tasks
Tasks must show ordered, verifiable states:
- [ ] Task 1: <Set up interfaces>
- [ ] Task 2: <Implement core logic>
- [ ] Task 3: <Integrate code>
- [ ] Task 4: <Run verification commands and check acceptance criteria>`;

export function planInstructions(planPath: string, objective: string): string {
	return `You are in PLAN MODE. Create an execution plan for: ${objective}

Write the plan to this exact path with the write tool: ${planPath}
This path is final. Use it again for later edits.

Inspect the relevant code before you write. Choose one solution. Keep every change inside the Scope Limits. Use skill:writing-in-ste for the plan prose.

Write the file with exactly this structure:

${PLAN_STRUCTURE}`;
}

export function editInstructions(planPath: string, objective: string): string {
	return `You are in PLAN-EDIT MODE. Update the existing plan for: ${objective}

Read the full plan first. Then change this file in place: ${planPath}

Keep the template sections and the file name. Do not create or rename plan files. Change only what the request needs. Use skill:writing-in-ste for the plan prose.`;
}

export function buildInstructions(planPath: string): string {
	return `You are in PLAN-BUILD MODE. Implement this plan: ${planPath}

1. Read the plan file fully before you change code.
2. Follow the Execution Tasks in order. Keep at most one task in progress.
3. Before execution tracking, check whether a todo-tracking tool is available. Use it if available, such as \`tools:write-todos\` or an equivalent.
4. When you use a todo-tracking tool, create one todo for each Execution Task and pass the full list as task statuses change. Do not update task checkboxes in the plan file.
5. If no todo-tracking tool is available, update task checkboxes in the plan file as each task finishes.
6. Stay inside the Scope Limits.
7. Run the Verification Commands after the last change. Inspect the full output.
8. Stop when the acceptance criteria pass.`;
}
