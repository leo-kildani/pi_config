/**
 * Unit tests for config.ts, the guard mode parsing and defaults.
 * Runs with the Node built-in test runner:
 *   node --experimental-strip-types --test extensions/max-bash-guard/config.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_CONFIG, parseGuardMode } from "./config.ts";

describe("parseGuardMode", () => {
	it("accepts the three guard modes", () => {
		assert.equal(parseGuardMode("free", "jail"), "free");
		assert.equal(parseGuardMode("trial", "free"), "trial");
		assert.equal(parseGuardMode("jail", "free"), "jail");
	});

	it("trims and lowercases the value", () => {
		assert.equal(parseGuardMode("  JAIL ", "free"), "jail");
		assert.equal(parseGuardMode("Trial", "free"), "trial");
	});

	it("falls back when the value is undefined", () => {
		assert.equal(parseGuardMode(undefined, "trial"), "trial");
	});

	it("falls back on an unknown value", () => {
		assert.equal(parseGuardMode("prison", "jail"), "jail");
	});
});

describe("DEFAULT_CONFIG", () => {
	it("runs three checkers and needs two safe votes", () => {
		assert.equal(DEFAULT_CONFIG.checkerCount, 3);
		assert.equal(DEFAULT_CONFIG.minSafeVotes, 2);
	});

	it("uses a positive checker timeout", () => {
		assert.ok(DEFAULT_CONFIG.checkerTimeoutMs > 0);
	});
});
