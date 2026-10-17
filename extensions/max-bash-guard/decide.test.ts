/**
 * Unit tests for decide.ts, the pure guard decision pipeline.
 * Runs with the Node built-in test runner:
 *   node --experimental-strip-types --test extensions/max-bash-guard/decide.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { afterVotes, summarizeVotes } from "./decide.ts";

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
