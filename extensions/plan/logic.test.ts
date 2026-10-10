import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { plansDirectory } from "./logic.ts";
import type { ClassifierResult } from "@earendil-works/pi-ai";
import {
	activePlanPath,
	buildIntentContext,
	buildInstructions,
	editInstructions,
	fallbackIntent,
	hasVerificationEvidence,
	planInstructions,
	recordVerificationCommand,
	verificationCommandsFromText,
	resolvePlanIntent,
	isForeignPlanPath,
	planObjectiveFromText,
	readIntent,
	validatePlan,
	type IntentState,
} from "./logic.ts";

const intentState = (overrides: Partial<IntentState> = {}): IntentState => ({
	request: "add a rollback note",
	hasActivePlan: true,
	activePlanPath: "/plans/active-abc.md",
	activePlanTitle: "Add Rollback Note",
	activePlanObjective: "Add a rollback note to the plan.",
	activePlanPhase: "planning",
	...overrides,
});

function classifierResult(choice: string, stopReason: ClassifierResult["stopReason"] = "stop"): ClassifierResult {
	return {
		api: "typesafe-system-one",
		provider: "typesafe",
		model: "jev-latest",
		answers: {
			intent: { type: "choice", choice, probabilities: { [choice]: 1 }, confidence: 1 },
		},
		stopReason,
		timestamp: 0,
	};
}

const validPlan = `# Plan: Add Example Feature

### Overview
Add the feature for operators who need the new workflow.

### Test-Driven Development
- **Applicability:** Required because this plan changes code.
- **RED:** Add and run a failing test for each behavior.
- **GREEN:** Implement the smallest change that passes each test.
- **REFACTOR:** Improve the code while all tests pass.

### Context & Baseline
- **Current State:** existing behavior.
- **Key Invariants:** preserve the API.

### Scope Boundaries
- **In-Scope:** the requested feature.
- **Out-of-Scope / Non-Goals:** unrelated work.

### Affected Files & Components
- \`src/index.ts\` — [MODIFY]: implement the feature.

### Technical Approach & Architecture
Use the existing service.

### Interfaces & Dependencies
- **Interfaces:** describe changed inputs and outputs.
- **Dependencies:** list packages and integration points.

### Verification & Acceptance Criteria
- **Acceptance Criteria:** the feature works.
- **Verification Commands:** \`npm test\`.

### Global Constraints
- Preserve existing command semantics.

### Execution Todos
- [ ] Task 1: implement the feature
- [ ] Task 2: run verification commands and verify acceptance criteria
`;

describe("plansDirectory", () => {
	it("places plans inside the configured Pi agent directory", () => {
		assert.equal(plansDirectory("/custom/pi/agent"), "/custom/pi/agent/plans");
	});
});

describe("validatePlan", () => {
	it("accepts the complete implementation-oriented structure", () => {
		const result = validatePlan(validPlan);
		assert.equal(result.valid, true);
		assert.deepEqual(result.errors, []);
	});

	it("reports missing implementation details with actionable errors", () => {
		const result = validatePlan("# Plan: Small Change\n\n### Overview\nOnly an overview.");
		assert.equal(result.valid, false);
		assert.ok(result.errors.some((error) => error.includes("Affected Files")));
		assert.ok(result.errors.some((error) => error.includes("Execution Todos")));
	});

	it("rejects a testable plan without a test-first sequence", () => {
		const plan = validPlan.replace(/### Test-Driven Development[\s\S]*?### Context & Baseline/, "### Context & Baseline");
		const result = validatePlan(plan);
		assert.equal(result.valid, false);
		assert.ok(result.errors.some((error) => error.includes("Test-Driven Development")));
	});

	it("rejects an applicable TDD section without all three phases", () => {
		const plan = validPlan.replace("- **REFACTOR:** Improve the code while all tests pass.\n", "");
		const result = validatePlan(plan);
		assert.equal(result.valid, false);
		assert.ok(result.errors.some((error) => error.includes("RED, GREEN, and REFACTOR")));
	});

	it("accepts a clear reason when TDD does not apply", () => {
		const plan = validPlan.replace(
			/### Test-Driven Development[\s\S]*?### Context & Baseline/,
			"### Test-Driven Development\n- **Applicability:** Not applicable because this plan changes no code or testable behavior.\n\n### Context & Baseline",
		);
		assert.equal(validatePlan(plan).valid, true);
	});

	it("requires a concise plan title with three or four words", () => {
		const plan = validPlan.replace("# Plan: Add Example Feature", "# Plan: Feature");
		const result = validatePlan(plan);
		assert.equal(result.valid, false);
		assert.ok(result.errors.some((error) => error.includes("three or four words")));
	});

	it("requires the plan title on the first line", () => {
		const result = validatePlan(`Draft note.\n\n${validPlan}`);
		assert.equal(result.valid, false);
		assert.ok(result.errors.some((error) => error.includes("First line")));
	});

	it("requires exact commands in the Verification Commands section", () => {
		const plan = validPlan.replace("`npm test`", "run the test suite");
		const result = validatePlan(plan);
		assert.equal(result.valid, false);
		assert.ok(result.errors.some((error) => error.includes("exact commands in backticks")));
	});
});

describe("planObjectiveFromText", () => {
	it("returns the Overview body collapsed to one line", () => {
		const text = "# Plan: Example\n\n### Overview\nBuild the feature.\nIt ships a flag.\n\n### Context & Baseline\n- Current.\n";
		assert.equal(planObjectiveFromText(text), "Build the feature. It ships a flag.");
	});

	it("returns null when the Overview section is missing", () => {
		assert.equal(planObjectiveFromText("# Plan: Example\n\n### Context & Baseline\n- Current.\n"), null);
	});

	it("returns null when the Overview section is empty", () => {
		assert.equal(planObjectiveFromText("# Plan: Example\n\n### Overview\n\n### Context & Baseline\n- Current.\n"), null);
	});
});

describe("readIntent", () => {
	it("returns the chosen intent from a stopped choice answer", () => {
		assert.equal(readIntent(classifierResult("edit")), "edit");
	});

	it("returns null when the classifier did not stop", () => {
		assert.equal(readIntent(classifierResult("edit", "error")), null);
	});

	it("returns null for a non-choice answer", () => {
		const result = classifierResult("edit");
		result.answers = { intent: { type: "bool", probability: 0.9 } };
		assert.equal(readIntent(result), null);
	});

	it("returns null for an unknown choice value", () => {
		assert.equal(readIntent(classifierResult("delete")), null);
	});
});

describe("plan prompts", () => {
	it("requires STE, TDD, and descriptive titles in plan creation instructions", () => {
		const prompt = planInstructions("/plans/add-feature-session.md", "Add a feature");
		assert.match(prompt, /skill:writing-in-ste/);
		assert.match(prompt, /skill:test-driven-development/);
		assert.match(prompt, /capability-specific/);
		assert.match(prompt, /Read before writing/);
		assert.doesNotMatch(prompt, /\b(subagent|explorer|surface-researcher)\b/i);
		assert.match(prompt, /full current list/);
	});

	it("requires full-list todo updates when building a plan", () => {
		const prompt = buildInstructions("/plans/add-feature-session.md");
		assert.match(prompt, /write-todos/);
		assert.match(prompt, /FULL current list/);
	});

	it("requires build agents to follow the plan's TDD sequence", () => {
		const prompt = buildInstructions("/plans/add-feature-session.md");
		assert.match(prompt, /Test-Driven Development/);
		assert.match(prompt, /before production code/);
	});

	it("requires STE and descriptive titles when editing a plan", () => {
		const prompt = editInstructions("/plans/add-feature-session.md", "Refine rollback steps");
		assert.match(prompt, /skill:writing-in-ste/);
		assert.match(prompt, /capability-specific/);
		assert.match(prompt, /full current list/);
	});
});

describe("resolvePlanIntent", () => {

	it("creates a separate plan when a new-plan request conflicts with an edit classification", () => {
		const state = intentState({ request: "Create a new plan for search indexing" });
		assert.equal(resolvePlanIntent(state, "edit"), "create");
	});

	it("uses create when classification fails for an active plan", () => {
		assert.equal(resolvePlanIntent(intentState(), null), "create");
	});

	it("keeps an explicit edit classification for the active plan", () => {
		const state = intentState({ request: "Refine the active plan's rollback step" });
		assert.equal(resolvePlanIntent(state, "edit"), "edit");
	});
});

describe("fallbackIntent", () => {
	it("returns create when no plan is active", () => {
		assert.equal(fallbackIntent(intentState({ hasActivePlan: false })), "create");
	});

	it("does not edit the active plan when classification fails", () => {
		assert.equal(fallbackIntent(intentState({ hasActivePlan: true })), "create");
	});
});

describe("isForeignPlanPath", () => {
	const plansDir = "/plans";
	const activePath = "/plans/active-abc.md";

	it("flags another markdown file in the plans directory", () => {
		assert.equal(isForeignPlanPath("/plans/other-def.md", plansDir, activePath), true);
	});

	it("does not flag the active plan path", () => {
		assert.equal(isForeignPlanPath(activePath, plansDir, activePath), false);
	});

	it("does not flag a file outside the plans directory", () => {
		assert.equal(isForeignPlanPath("/elsewhere/other.md", plansDir, activePath), false);
	});

	it("does not flag a non-markdown file in the plans directory", () => {
		assert.equal(isForeignPlanPath("/plans/notes.txt", plansDir, activePath), false);
	});

	it("does not flag a path that escapes the plans directory", () => {
		assert.equal(isForeignPlanPath("/plans/../secret.md", plansDir, activePath), false);
	});
});

describe("buildIntentContext", () => {
	it("maps state to classifier keys and declares the three intent choices", () => {
		const context = buildIntentContext(intentState({ hasActivePlan: false, activePlanPath: null }));
		assert.equal(context.state.request, "add a rollback note");
		assert.equal(context.state.has_active_plan, false);
		assert.equal(context.state.active_plan_objective, "Add a rollback note to the plan.");
		const question = context.questions.intent;
		assert.equal(question.type, "choice");
		if (question.type === "choice") {
			assert.deepEqual(Object.keys(question.criteria).sort(), ["build", "create", "edit"]);
		}
	});
});

describe("verification commands", () => {
	it("extracts only commands from the Verification Commands section", () => {
		assert.deepEqual(verificationCommandsFromText(validPlan), ["npm test"]);
	});

	it("records only successful commands listed by the plan", () => {
		assert.deepEqual(recordVerificationCommand([], "pnpm test", ["pnpm test", "pnpm typecheck"]), ["pnpm test"]);
	});

	it("clears evidence after an unrelated command", () => {
		assert.deepEqual(recordVerificationCommand(["pnpm test"], "echo done", ["pnpm test"]), []);
	});

	it("clears evidence after a failed listed command", () => {
		assert.deepEqual(recordVerificationCommand(["pnpm test"], "pnpm test", ["pnpm test"], true), []);
	});
});

describe("hasVerificationEvidence", () => {
	const tool = (toolName: string, command?: string, isError = false) => ({ role: "toolResult", toolName, command, isError });

	it("accepts every successful listed command after the last code change", () => {
		assert.equal(hasVerificationEvidence([
			tool("edit"),
			tool("bash", "pnpm test"),
			tool("bash", "pnpm typecheck"),
		], ["pnpm test", "pnpm typecheck"]), true);
	});

	it("rejects an unrelated successful command", () => {
		assert.equal(hasVerificationEvidence([tool("bash", "echo done")], ["pnpm test"]), false);
	});

	it("rejects listed commands that ran before the last code change", () => {
		assert.equal(hasVerificationEvidence([
			tool("bash", "pnpm test"),
			tool("write"),
		], ["pnpm test"]), false);
	});

	it("rejects a failed listed command", () => {
		assert.equal(hasVerificationEvidence([tool("bash", "pnpm test", true)], ["pnpm test"]), false);
	});
});

describe("activePlanPath", () => {
	const active = { sessionId: "s1", planPath: "/plans/active-s1.md", phase: "executing" };

	it("returns null when the recorded plan is done", () => {
		assert.equal(activePlanPath({ ...active, phase: "done" }, "s1", true, "/plans/active-s1.md"), null);
	});

	it("returns the recorded path when the plan is active and the file exists", () => {
		assert.equal(activePlanPath(active, "s1", true, "/plans/newer-s1.md"), "/plans/active-s1.md");
	});

	it("returns the newest path when the recorded file is missing", () => {
		assert.equal(activePlanPath(active, "s1", false, "/plans/newer-s1.md"), "/plans/newer-s1.md");
	});

	it("returns the newest path when the record belongs to another session", () => {
		assert.equal(
			activePlanPath({ sessionId: "s2", planPath: "/plans/active-s2.md", phase: "planning" }, "s1", true, "/plans/newer-s1.md"),
			"/plans/newer-s1.md",
		);
	});
});
