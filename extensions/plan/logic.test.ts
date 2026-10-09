import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { plansDirectory } from "./logic.ts";
import type { ClassifierResult } from "@earendil-works/pi-ai";
import {
	buildIntentContext,
	fallbackIntent,
	hasVerificationEvidence,
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

const validPlan = `# Plan: Example Change

### Overview
Build the feature.

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

describe("fallbackIntent", () => {
	it("returns create when no plan is active", () => {
		assert.equal(fallbackIntent(intentState({ hasActivePlan: false })), "create");
	});

	it("returns edit when a plan is active", () => {
		assert.equal(fallbackIntent(intentState({ hasActivePlan: true })), "edit");
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

describe("hasVerificationEvidence", () => {
	const tool = (toolName: string, isError = false) => ({ role: "toolResult", toolName, isError });

	it("accepts a successful command after the last code change", () => {
		assert.equal(hasVerificationEvidence([tool("edit"), tool("write"), tool("bash")]), true);
	});

	it("rejects a command that ran before the last code change", () => {
		assert.equal(hasVerificationEvidence([tool("bash"), tool("write")]), false);
	});

	it("rejects a failed command", () => {
		assert.equal(hasVerificationEvidence([tool("edit"), tool("bash", true)]), false);
	});

	it("ignores a failed edit when finding the last code change", () => {
		assert.equal(hasVerificationEvidence([tool("write", true), tool("bash")]), true);
	});
});
