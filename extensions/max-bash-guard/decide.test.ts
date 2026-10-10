/**
 * Unit tests for decide.ts, the pure guard mode pipeline and vote summary.
 * Runs with the Node built-in test runner:
 *   node --experimental-strip-types --test extensions/max-bash-guard/decide.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { afterDeterministic, afterVotes, parseCheckerReply, summarizeVotes } from "./decide.ts";

describe("parseCheckerReply", () => {
	it("reads SAFE as safe", () => {
		assert.equal(parseCheckerReply("SAFE"), "safe");
		assert.equal(parseCheckerReply("  safe\n"), "safe");
	});

	it("reads DESTRUCTIVE as destructive", () => {
		assert.equal(parseCheckerReply("DESTRUCTIVE"), "destructive");
		assert.equal(parseCheckerReply(" destructive. "), "destructive");
	});

	it("reads anything else as unknown", () => {
		assert.equal(parseCheckerReply("maybe"), "unknown");
		assert.equal(parseCheckerReply(""), "unknown");
	});
});

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

describe("afterDeterministic", () => {
	it("runs every command in free mode", () => {
		assert.equal(afterDeterministic("free", "none"), "run");
		assert.equal(afterDeterministic("free", "review"), "run");
	});

	it("asks on a review in trial mode and runs the rest", () => {
		assert.equal(afterDeterministic("trial", "review"), "ask");
		assert.equal(afterDeterministic("trial", "none"), "run");
		assert.equal(afterDeterministic("trial", "allow"), "run");
	});

	it("asks on a review in jail mode and votes on the rest", () => {
		assert.equal(afterDeterministic("jail", "review"), "ask");
		assert.equal(afterDeterministic("jail", "none"), "vote");
		assert.equal(afterDeterministic("jail", "allow"), "vote");
	});
});

describe("afterVotes", () => {
	const policy = { checkerCount: 3, minSafeVotes: 2 };

	it("runs when two of three checkers report safe", () => {
		assert.equal(afterVotes(summarizeVotes(["safe", "safe", "destructive"]), policy), "run");
		assert.equal(afterVotes(summarizeVotes(["safe", "safe", "safe"]), policy), "run");
	});

	it("asks when one checker reports safe", () => {
		assert.equal(afterVotes(summarizeVotes(["safe", "destructive", "destructive"]), policy), "ask");
	});

	it("treats unknown replies as not safe", () => {
		assert.equal(afterVotes(summarizeVotes(["safe", "unknown", "unknown"]), policy), "ask");
	});

	it("asks when no checker reports safe", () => {
		assert.equal(afterVotes(summarizeVotes(["destructive", "unknown", "destructive"]), policy), "ask");
	});

	it("honors a higher safe-vote threshold", () => {
		assert.equal(afterVotes(summarizeVotes(["safe", "safe", "destructive"]), { checkerCount: 3, minSafeVotes: 3 }), "ask");
	});
});
