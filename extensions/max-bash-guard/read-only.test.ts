/**
 * Tests for the conservative read-only bash command classifier.
 * Run with:
 *   node --experimental-strip-types --test extensions/max-bash-guard/read-only.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { evaluateReadOnlyCommand } from "./read-only.ts";

const cwd = process.cwd();

describe("evaluateReadOnlyCommand", () => {
	it("allows file inspection commands", () => {
		for (const command of ["cat README.md", "ls -la extensions", "head -n 20 README.md", "grep -n plan README.md", "echo hi", "printf %s hi"]) {
			assert.equal(evaluateReadOnlyCommand(command, cwd).action, "allow", command);
		}
	});

	it("allows safe git inspection and GET requests", () => {
		for (const command of ["git diff -- README.md", "git show HEAD:README.md", "curl -q https://example.com", "curl -q -X GET https://example.com"]) {
			assert.equal(evaluateReadOnlyCommand(command, cwd).action, "allow", command);
		}
	});

	it("allows chains only when every command is read-only", () => {
		assert.equal(evaluateReadOnlyCommand("git diff -- README.md | head -n 20", cwd).action, "allow");
		assert.equal(evaluateReadOnlyCommand("cat README.md && git status --short", cwd).action, "allow");
		assert.equal(evaluateReadOnlyCommand("cat README.md | tee copy.txt", cwd).action, "block");
	});

	it("allows expansion, globs, and input redirection in read-only commands", () => {
		assert.equal(evaluateReadOnlyCommand("cat *.md", cwd).action, "allow");
		assert.equal(evaluateReadOnlyCommand("ls ~", cwd).action, "allow");
		assert.equal(evaluateReadOnlyCommand('cat "$HOME/README.md"', cwd).action, "allow");
		assert.equal(evaluateReadOnlyCommand("cat README.md < input.txt", cwd).action, "allow");
	});

	it("blocks reads of secrets", () => {
		for (const command of ["cat .env", "cat ~/.ssh/id_rsa", "cat config/client-secret.json", "env", "printenv PATH"]) {
			assert.equal(evaluateReadOnlyCommand(command, cwd).action, "block", command);
		}
	});

	it("blocks commands that can write or make a non-GET request", () => {
		for (const command of [
			"touch marker",
			"rm file",
			"git commit -m change",
			"curl https://example.com",
			"curl -o response.txt https://example.com",
			"curl -X POST https://example.com",
			"sed -i s/a/b/ file.txt",
		]) {
			assert.equal(evaluateReadOnlyCommand(command, cwd).action, "block", command);
		}
	});

	it("blocks unknown commands and ambiguous shell syntax", () => {
		for (const command of [
			"python inspect.py",
			"cat README.md > copy.txt",
			"cat $(touch marker)",
			"cat README.md\ntouch marker",
		]) {
			assert.equal(evaluateReadOnlyCommand(command, cwd).action, "block", command);
		}
	});
});
