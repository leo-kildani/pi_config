/**
 * Unit tests for analyze.ts, the chain split and per-command verdicts.
 * Runs with the Node built-in test runner:
 *   node --experimental-strip-types --test extensions/max-bash-guard/analyze.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { evaluateCommandChain, splitCommandChain } from "./analyze.ts";

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

describe("evaluateCommandChain", () => {
	it("returns one verdict for a single command", () => {
		const verdicts = evaluateCommandChain("ls src", cwd, undefined, "on");
		assert.deepEqual(verdicts, [
			{ text: "ls src", start: 0, end: 6, safe: true, provenReadOnly: true, reason: undefined },
		]);
	});

	it("returns one verdict per command in a chain", () => {
		const verdicts = evaluateCommandChain("echo x && rm -rf / && ls", cwd, undefined, "on");
		assert.deepEqual(verdicts.map((verdict) => verdict.text), ["echo x", "rm -rf /", "ls"]);
		assert.equal(verdicts[1]!.safe, false);
		assert.ok(verdicts[1]!.reason?.includes("recursive force delete"));
	});

	it("keeps the offsets aligned with the source", () => {
		const command = "  echo a &&  rm -rf / ";
		for (const verdict of evaluateCommandChain(command, cwd, undefined, "on")) {
			assert.equal(command.slice(verdict.start, verdict.end), verdict.text);
		}
	});

	it("blocks only the command that reads a secret", () => {
		const verdicts = evaluateCommandChain("cat .env && echo done", cwd, undefined, "on");
		assert.equal(verdicts[0]!.safe, false);
		assert.equal(verdicts[0]!.reason, "command reads a secret");
		assert.equal(verdicts[1]!.safe, true);
	});

	it("blocks only the write command", () => {
		const verdicts = evaluateCommandChain("ls && touch marker", cwd, undefined, "on");
		assert.equal(verdicts[0]!.safe, true);
		assert.equal(verdicts[1]!.safe, false);
		assert.equal(verdicts[1]!.reason, "write or destructive command");
	});

	it("blocks only the out-of-scope command", () => {
		const verdicts = evaluateCommandChain("echo x && cat /etc/hosts", cwd, cwd, "on");
		assert.equal(verdicts[0]!.safe, true);
		assert.equal(verdicts[1]!.safe, false);
		assert.ok(verdicts[1]!.reason?.includes("path outside scope"));
	});

	it("marks a proven read-only command", () => {
		const [verdict] = evaluateCommandChain("git status", cwd, undefined, "on");
		assert.equal(verdict!.safe, true);
		assert.equal(verdict!.provenReadOnly, true);
	});

	it("marks an unproven safe command for the checker", () => {
		const [verdict] = evaluateCommandChain("python script.py", cwd, undefined, "on");
		assert.equal(verdict!.safe, true);
		assert.equal(verdict!.provenReadOnly, false);
		assert.equal(verdict!.reason, undefined);
	});

	it("blocks an unproven command in read-only mode", () => {
		const [verdict] = evaluateCommandChain("python script.py", cwd, undefined, "read-only");
		assert.equal(verdict!.safe, false);
		assert.equal(verdict!.reason, "command is not proven read-only");
	});

	it("blocks a write command in read-only mode with the policy reason", () => {
		const [verdict] = evaluateCommandChain("touch marker", cwd, undefined, "read-only");
		assert.equal(verdict!.safe, false);
		assert.equal(verdict!.reason, "write or destructive command");
	});

	it("marks every command safe in off mode", () => {
		const verdicts = evaluateCommandChain("rm -rf /", cwd, undefined, "off");
		assert.equal(verdicts[0]!.safe, true);
	});

	it("blocks every unsafe command in a chain", () => {
		const verdicts = evaluateCommandChain("cat .env && rm -rf /", cwd, undefined, "on");
		assert.deepEqual(verdicts.map((verdict) => verdict.safe), [false, false]);
	});
});
