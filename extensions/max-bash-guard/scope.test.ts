/**
 * Unit tests for scope.ts, the directory boundary for the guard.
 * Runs with the Node built-in test runner:
 *   node --experimental-strip-types --test extensions/max-bash-guard/scope.test.ts
 */

import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { evaluateScope, readScopePath, resolveScopePath } from "./scope.ts";

const FIXTURE_BASE = existsSync("/var/tmp") ? "/var/tmp" : homedir();

let root: string;
let cwd: string;

function writeScopeFile(content: string): void {
	writeFileSync(path.join(cwd, "maxguard.env"), content);
}

beforeEach(() => {
	root = mkdtempSync(path.join(FIXTURE_BASE, "max-bash-guard-scope-"));
	cwd = path.join(root, "repo");
	mkdirSync(cwd);
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

describe("readScopePath", () => {
	it("returns the SCOPE value and strips double quotes", () => {
		writeScopeFile('SCOPE="/some/path"\n');
		assert.equal(readScopePath(cwd), "/some/path");
	});

	it("strips single quotes", () => {
		writeScopeFile("SCOPE='other'\n");
		assert.equal(readScopePath(cwd), "other");
	});

	it("returns undefined when the file is absent", () => {
		assert.equal(readScopePath(cwd), undefined);
	});

	it("returns undefined when there is no SCOPE line", () => {
		writeScopeFile("OTHER=value\n");
		assert.equal(readScopePath(cwd), undefined);
	});

	it("returns undefined for an empty SCOPE value", () => {
		writeScopeFile('SCOPE=""\n');
		assert.equal(readScopePath(cwd), undefined);
	});
});

describe("resolveScopePath", () => {
	it("returns undefined for off", () => {
		assert.equal(resolveScopePath("off", cwd), undefined);
	});

	it("returns cwd for cwd", () => {
		assert.equal(resolveScopePath("cwd", cwd), cwd);
	});

	it("returns cwd for custom when maxguard.env is absent", () => {
		assert.equal(resolveScopePath("custom", cwd), cwd);
	});

	it("resolves an absolute SCOPE value", () => {
		writeScopeFile(`SCOPE="${root}"\n`);
		assert.equal(resolveScopePath("custom", cwd), root);
	});

	it("resolves a relative SCOPE value against cwd", () => {
		mkdirSync(path.join(cwd, "sub"));
		writeScopeFile('SCOPE="sub"\n');
		assert.equal(resolveScopePath("custom", cwd), path.join(cwd, "sub"));
	});

	it("falls back to cwd when the path is not a directory", () => {
		const file = path.join(root, "outside.txt");
		writeFileSync(file, "outside");
		writeScopeFile(`SCOPE="${file}"\n`);
		assert.equal(resolveScopePath("custom", cwd), cwd);
	});

	it("falls back to cwd for an empty SCOPE value", () => {
		writeScopeFile('SCOPE=""\n');
		assert.equal(resolveScopePath("custom", cwd), cwd);
	});
});

describe("evaluateScope", () => {
	it("returns none when the scope is undefined", () => {
		assert.deepEqual(evaluateScope(`cat ${path.join(root, "outside.txt")}`, cwd, undefined), { action: "none" });
	});

	it("returns none for a path inside the scope", () => {
		const inside = path.join(cwd, "inside.txt");
		writeFileSync(inside, "inside");
		assert.deepEqual(evaluateScope(`cat ${inside}`, cwd, cwd), { action: "none" });
	});

	it("reviews a path outside the scope", () => {
		const outside = path.join(root, "outside.txt");
		writeFileSync(outside, "outside");
		const decision = evaluateScope(`cat ${outside}`, cwd, cwd);
		assert.equal(decision.action, "review");
		assert.ok("reason" in decision && decision.reason.includes("path outside scope"));
	});

	it("does not review a path inside /tmp", () => {
		assert.deepEqual(evaluateScope("cat /tmp/max-bash-guard-scope-test", cwd, cwd), { action: "none" });
	});
});
