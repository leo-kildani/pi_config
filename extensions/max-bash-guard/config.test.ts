/**
 * Unit tests for config.ts, the guard mode parsing and defaults.
 * Runs with the Node built-in test runner:
 *   node --experimental-strip-types --test extensions/max-bash-guard/config.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_CONFIG, parseCheckerEnabled, parseGuardMode } from "./config.ts";

describe("parseCheckerEnabled", () => {
	it("accepts the on and off spellings", () => {
		assert.equal(parseCheckerEnabled("on", false), true);
		assert.equal(parseCheckerEnabled(" true ", false), true);
		assert.equal(parseCheckerEnabled("1", false), true);
		assert.equal(parseCheckerEnabled("off", true), false);
		assert.equal(parseCheckerEnabled("FALSE", true), false);
		assert.equal(parseCheckerEnabled("0", true), false);
	});

	it("falls back when the value is undefined or unknown", () => {
		assert.equal(parseCheckerEnabled(undefined, true), true);
		assert.equal(parseCheckerEnabled("maybe", false), false);
	});
});

describe("parseGuardMode", () => {
	it("accepts the three guard modes", () => {
		assert.equal(parseGuardMode("off", "on"), "off");
		assert.equal(parseGuardMode("on", "off"), "on");
		assert.equal(parseGuardMode("read-only", "on"), "read-only");
	});

	it("maps the legacy modes", () => {
		assert.equal(parseGuardMode("free", "read-only"), "off");
		assert.equal(parseGuardMode("trial", "read-only"), "on");
		assert.equal(parseGuardMode("jail", "read-only"), "on");
	});

	it("trims and lowercases the value", () => {
		assert.equal(parseGuardMode("  ON ", "off"), "on");
		assert.equal(parseGuardMode("Read-Only", "off"), "read-only");
		assert.equal(parseGuardMode("JAIL", "off"), "on");
	});

	it("falls back when the value is undefined", () => {
		assert.equal(parseGuardMode(undefined, "on"), "on");
	});

	it("falls back on an unknown value", () => {
		assert.equal(parseGuardMode("prison", "read-only"), "read-only");
	});
});

describe("DEFAULT_CONFIG", () => {
	it("defaults to read-only mode", () => {
		assert.equal(DEFAULT_CONFIG.mode, "read-only");
	});

	it("enables the checker by default", () => {
		assert.equal(DEFAULT_CONFIG.checkerEnabled, true);
	});

	it("uses a positive checker timeout", () => {
		assert.ok(DEFAULT_CONFIG.checkerTimeoutMs > 0);
	});
});
