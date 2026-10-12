import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	buildAction,
	buildInstructions,
	editInstructions,
	planAction,
	planFileName,
	planInstructions,
	plansDirectory,
	synthesizePlanName,
} from "./logic.ts";

describe("plansDirectory", () => {
	it("places plans inside the configured Pi agent directory", () => {
		assert.equal(plansDirectory("/custom/pi/agent"), "/custom/pi/agent/plans");
	});
});

describe("synthesizePlanName", () => {
	it("strips filler words and takes the first three content words", () => {
		assert.equal(synthesizePlanName("I want to build a plan extension"), "build-plan-extension");
	});

	it("lowercases, drops punctuation, and keeps only three words", () => {
		assert.equal(synthesizePlanName("Refactor the webtools config command now"), "refactor-webtools-config");
	});

	it("falls back to plan when no content words remain", () => {
		assert.equal(synthesizePlanName("the a an to for of"), "plan");
	});
});

describe("planFileName", () => {
	it("appends the session id and the markdown extension", () => {
		assert.equal(planFileName("build-plan-extension", "01a12d01"), "build-plan-extension-01a12d01.md");
	});
});

describe("planAction", () => {
	it("creates when no plan is set", () => {
		assert.equal(planAction(null), "create");
	});

	it("edits a pending plan", () => {
		assert.equal(planAction("pending"), "edit");
	});

	it("creates a new plan when the current plan is built", () => {
		assert.equal(planAction("built"), "create");
	});
});

describe("buildAction", () => {
	it("does nothing when no plan is set", () => {
		assert.equal(buildAction(null), "none");
	});

	it("builds a pending plan", () => {
		assert.equal(buildAction("pending"), "build");
	});

	it("reports a built plan as already built", () => {
		assert.equal(buildAction("built"), "already");
	});
});

const HEADINGS = [
	"# Plan:",
	"### Overview",
	"### Context and Baseline",
	"### Scope Limits",
	"### Affected Files and Components",
	"### Technical Approach and Architecture",
	"### Interfaces and Dependencies",
	"### Verification and Acceptance Criteria",
	"### Global Constraints",
	"### Execution Tasks",
];

describe("planInstructions", () => {
	it("names the exact plan path and the objective", () => {
		const prompt = planInstructions("/plans/build-plan-abc.md", "Add a rollback note");
		assert.match(prompt, /\/plans\/build-plan-abc\.md/);
		assert.match(prompt, /Add a rollback note/);
	});

	it("embeds the full plan template", () => {
		const prompt = planInstructions("/plans/build-plan-abc.md", "Add a rollback note");
		for (const heading of HEADINGS) assert.ok(prompt.includes(heading), `missing heading: ${heading}`);
	});

	it("tells the agent to write the plan file", () => {
		const prompt = planInstructions("/plans/build-plan-abc.md", "Add a rollback note");
		assert.match(prompt, /write tool/i);
	});
});

describe("editInstructions", () => {
	it("names the existing file and the requested change", () => {
		const prompt = editInstructions("/plans/build-plan-abc.md", "Refine the rollback step");
		assert.match(prompt, /\/plans\/build-plan-abc\.md/);
		assert.match(prompt, /Refine the rollback step/);
	});

	it("tells the agent to change the file in place", () => {
		const prompt = editInstructions("/plans/build-plan-abc.md", "Refine the rollback step");
		assert.match(prompt, /in place/i);
	});
});

describe("buildInstructions", () => {
	it("names the plan file and the execution tasks section", () => {
		const prompt = buildInstructions("/plans/build-plan-abc.md");
		assert.match(prompt, /\/plans\/build-plan-abc\.md/);
		assert.match(prompt, /Execution Tasks/);
	});

	it("uses an available todo tool without updating plan task checkboxes", () => {
		const prompt = buildInstructions("/plans/build-plan-abc.md");
		assert.match(prompt, /todo-tracking tool.*available/i);
		assert.match(prompt, /tools:write-todos.*equivalent/i);
		assert.match(prompt, /Do not update task checkboxes in the plan file/i);
	});

	it("falls back to plan task checkboxes when no todo tool is available", () => {
		const prompt = buildInstructions("/plans/build-plan-abc.md");
		assert.match(prompt, /If no todo-tracking tool is available, update task checkboxes in the plan file/i);
	});

	it("tells the agent to run the verification commands", () => {
		const prompt = buildInstructions("/plans/build-plan-abc.md");
		assert.match(prompt, /Verification Commands/);
	});
});
