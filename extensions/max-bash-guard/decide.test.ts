/**
 * Unit tests for decide.ts, the pure guard decision pipeline.
 * Runs with the Node built-in test runner:
 *   node --experimental-strip-types --test extensions/max-bash-guard/decide.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { afterVotes, decideGuardStep, summarizeVotes } from "./decide.ts";

describe("summarizeVotes", () => {
	it("counts each reply class", () => {
		const summary = summarizeVotes(["safe", "safe", "destructive"]);
		assert.deepEqual(summary, { safe: 2, destructive: 1, unknown: 0, total: 3 });
	});

	it("counts unknown replies", () => {
		const summary = summarizeVotes(["safe", "unknown", "unknown"]);
		assert.equal(summary.unknown, 2);
		assert.equal(summary.total, 3);
	});
});

describe("decideGuardStep", () => {
	it("runs every command in off mode", () => {
		for (const category of ["read-only", "secret", "write", "scope", "unknown"] as const) {
			assert.equal(decideGuardStep("off", category, true), "run");
			assert.equal(decideGuardStep("off", category, false), "run");
		}
	});

	it("runs read-only commands and blocks the rest in read-only mode", () => {
		assert.equal(decideGuardStep("read-only", "read-only", true), "run");
		assert.equal(decideGuardStep("read-only", "secret", true), "block");
		assert.equal(decideGuardStep("read-only", "write", true), "block");
		assert.equal(decideGuardStep("read-only", "scope", true), "block");
		assert.equal(decideGuardStep("read-only", "unknown", true), "block");
	});

	it("allows read-only commands in on mode", () => {
		assert.equal(decideGuardStep("on", "read-only", true), "run");
		assert.equal(decideGuardStep("on", "read-only", false), "run");
	});

	it("prompts for secret reads in on mode", () => {
		assert.equal(decideGuardStep("on", "secret", true), "prompt");
		assert.equal(decideGuardStep("on", "secret", false), "prompt");
	});

	it("prompts for write commands in on mode", () => {
		assert.equal(decideGuardStep("on", "write", true), "prompt");
		assert.equal(decideGuardStep("on", "write", false), "prompt");
	});

	it("blocks scope violations in on mode", () => {
		assert.equal(decideGuardStep("on", "scope", true), "block");
		assert.equal(decideGuardStep("on", "scope", false), "block");
	});

	it("votes on unknown commands only when the checker is enabled", () => {
		assert.equal(decideGuardStep("on", "unknown", true), "vote");
		assert.equal(decideGuardStep("on", "unknown", false), "prompt");
	});
});

describe("afterVotes", () => {
	it("runs when the checker reports safe", () => {
		assert.equal(afterVotes(summarizeVotes(["safe"])), "run");
	});

	it("prompts when the checker does not report safe", () => {
		assert.equal(afterVotes(summarizeVotes(["destructive"])), "prompt");
		assert.equal(afterVotes(summarizeVotes(["unknown"])), "prompt");
		assert.equal(afterVotes(summarizeVotes([])), "prompt");
	});
});
