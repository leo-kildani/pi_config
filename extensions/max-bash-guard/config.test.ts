/**
 * Unit tests for config.ts, the guard mode parsing and defaults.
 * Runs with the Node built-in test runner:
 *   node --experimental-strip-types --test extensions/max-bash-guard/config.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_CONFIG, parseCheckerCount, parseGuardMode, scaleMinSafeVotes } from "./config.ts";

describe("parseCheckerCount", () => {
	it("accepts only 1, 3, or 5 checkers", () => {
		assert.equal(parseCheckerCount("1", 3), 1);
		assert.equal(parseCheckerCount("3", 1), 3);
		assert.equal(parseCheckerCount("5", 3), 5);
		assert.equal(parseCheckerCount("2", 3), 3);
		assert.equal(parseCheckerCount("10", 1), 1);
	});
});

describe("scaleMinSafeVotes", () => {
	it("keeps the configured safe-vote ratio when checker count changes", () => {
		assert.equal(scaleMinSafeVotes(1, 3, 2), 1);
		assert.equal(scaleMinSafeVotes(3, 3, 2), 2);
		assert.equal(scaleMinSafeVotes(5, 3, 2), 4);
	});
});

describe("parseGuardMode", () => {
	it("accepts all four guard modes", () => {
		assert.equal(parseGuardMode("free", "jail"), "free");
		assert.equal(parseGuardMode("trial", "free"), "trial");
		assert.equal(parseGuardMode("jail", "free"), "jail");
		assert.equal(parseGuardMode("read-only", "free"), "read-only");
	});

	it("trims and lowercases the value", () => {
		assert.equal(parseGuardMode("  JAIL ", "free"), "jail");
		assert.equal(parseGuardMode("Trial", "free"), "trial");
		assert.equal(parseGuardMode("  READ-ONLY ", "free"), "read-only");
	});

	it("falls back when the value is undefined", () => {
		assert.equal(parseGuardMode(undefined, "trial"), "trial");
	});

	it("falls back on an unknown value", () => {
		assert.equal(parseGuardMode("prison", "jail"), "jail");
	});
});

describe("DEFAULT_CONFIG", () => {
	it("defaults to read-only mode", () => {
		assert.equal(DEFAULT_CONFIG.mode, "read-only");
	});

	it("runs three checkers and needs two safe votes", () => {
		assert.equal(DEFAULT_CONFIG.checkerCount, 3);
		assert.equal(DEFAULT_CONFIG.minSafeVotes, 2);
	});

	it("uses a positive checker timeout", () => {
		assert.ok(DEFAULT_CONFIG.checkerTimeoutMs > 0);
	});
});
