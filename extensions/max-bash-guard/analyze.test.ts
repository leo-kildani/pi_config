/**
 * Unit tests for analyze.ts, the chain split and destructive span detection.
 * Runs with the Node built-in test runner:
 *   node --experimental-strip-types --test extensions/max-bash-guard/analyze.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { analyzeCommand, splitCommandChain } from "./analyze.ts";

const cwd = process.cwd();

describe("splitCommandChain", () => {
	it("returns one span for a command without separators", () => {
		assert.deepEqual(splitCommandChain("ls src"), [{ text: "ls src", start: 0, end: 6 }]);
	});

	it("splits on a semicolon", () => {
		const spans = splitCommandChain("echo a; echo b");
		assert.deepEqual(spans, [
			{ text: "echo a", start: 0, end: 6 },
			{ text: "echo b", start: 8, end: 14 },
		]);
	});

	it("splits on && and ||", () => {
		assert.deepEqual(splitCommandChain("a && b").map((s) => s.text), ["a", "b"]);
		assert.deepEqual(splitCommandChain("a || b").map((s) => s.text), ["a", "b"]);
	});

	it("splits on a pipe", () => {
		assert.deepEqual(splitCommandChain("cat a | grep b").map((s) => s.text), ["cat a", "grep b"]);
	});

	it("splits on a newline", () => {
		assert.deepEqual(splitCommandChain("echo a\necho b").map((s) => s.text), ["echo a", "echo b"]);
	});

	it("does not split a quoted separator", () => {
		const spans = splitCommandChain('echo "a; b && c"');
		assert.equal(spans.length, 1);
		assert.equal(spans[0]!.text, 'echo "a; b && c"');
	});

	it("does not split a single background ampersand", () => {
		assert.deepEqual(splitCommandChain("sleep 1 & echo done").map((s) => s.text), ["sleep 1 & echo done"]);
	});

	it("keeps offsets aligned with the source", () => {
		const command = "  echo a &&  rm -rf / ";
		for (const span of splitCommandChain(command)) {
			assert.equal(command.slice(span.start, span.end), span.text);
		}
	});
});

describe("analyzeCommand", () => {
	it("marks only the destructive segment of a chain", () => {
		const analysis = analyzeCommand("echo x && rm -rf / && ls", cwd);
		assert.equal(analysis.destructive, true);
		assert.equal(analysis.spans.length, 1);
		assert.equal(analysis.spans[0]!.text, "rm -rf /");
		assert.equal(analysis.spans[0]!.start, 10);
		assert.equal(analysis.spans[0]!.end, 18);
		assert.ok(analysis.reasons.some((reason) => reason.includes("recursive force delete")));
	});

	it("reports a safe command as not destructive", () => {
		const analysis = analyzeCommand("ls src", cwd);
		assert.equal(analysis.destructive, false);
		assert.deepEqual(analysis.spans, []);
	});

	it("marks the whole command when only the whole command triggers", () => {
		const analysis = analyzeCommand("echo a\necho b", cwd);
		assert.equal(analysis.destructive, true);
		assert.equal(analysis.spans.length, 1);
		assert.equal(analysis.spans[0]!.text, "echo a\necho b");
		assert.ok(analysis.reasons.some((reason) => reason.includes("newline")));
	});
});
