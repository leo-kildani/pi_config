/**
 * Unit tests for extensionloader.ts, the extension-name-to-path resolver.
 * Runs with the Node built-in test runner, no dependencies:
 *   node --experimental-strip-types --test extensionloader.test.ts
 *
 * Pi 1.0.0 makes `--no-extensions` suppress built-in extensions too. An agent
 * re-enables one by declaring `builtin:<name>`, which this loader must pass
 * through to pi's `-e` flag unchanged.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { resolveExtensionLoadPaths } from "./extensionloader.ts";

test("passes builtin: names through without touching disk", () => {
	const resolved = resolveExtensionLoadPaths(
		["builtin:mcp"],
		"/nonexistent/pi-cwd",
	);
	assert.deepEqual(resolved, ["builtin:mcp"]);
});

test("skips a bare builtin: prefix", () => {
	const resolved = resolveExtensionLoadPaths([], "/nonexistent/pi-cwd");
	assert.deepEqual(resolved, []);
	assert.deepEqual(resolveExtensionLoadPaths(["builtin:"], "/nonexistent/pi-cwd"), []);
});

test("skips unsafe names and dedupes", () => {
	const resolved = resolveExtensionLoadPaths(
		["../evil", "builtin:mcp", "builtin:mcp"],
		"/nonexistent/pi-cwd",
	);
	assert.deepEqual(resolved, ["builtin:mcp"]);
});

test("keeps declared order for builtin and file entries", () => {
	const cwd = mkdtempSync(join(tmpdir(), "subagent-extloader-"));
	try {
		const root = join(cwd, ".pi", "extensions");
		mkdirSync(root, { recursive: true });
		writeFileSync(join(root, "webtools.ts"), "");
		const resolved = resolveExtensionLoadPaths(["builtin:mcp", "webtools"], cwd);
		assert.deepEqual(resolved, ["builtin:mcp", join(root, "webtools.ts")]);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});
