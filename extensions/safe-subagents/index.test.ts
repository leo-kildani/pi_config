import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import safeSubagents from "./index.ts";

const tempDirs: string[] = [];

afterEach(() => {
	for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function inputHandler() {
	let handler: ((event: { text: string; source: "extension" }, ctx: ExtensionContext) => unknown) | undefined;
	const pi = {
		on: (event: string, callback: typeof handler) => {
			if (event === "input") handler = callback;
		},
		registerTool() {},
	} as unknown as ExtensionAPI;
	safeSubagents(pi);
	assert.ok(handler);
	return handler;
}

describe("safe-subagents input mentions", () => {
	it("expands mentions in extension-generated prompts", () => {
		const cwd = mkdtempSync(join(tmpdir(), "safe-subagents-"));
		tempDirs.push(cwd);
		const agentsDir = join(cwd, ".pi", "agents");
		mkdirSync(agentsDir, { recursive: true });
		writeFileSync(join(agentsDir, "code-reviewer.md"), "---\nname: code-reviewer\ndescription: Reviews code\n---\n");

		const result = inputHandler()({ source: "extension", text: "/plan use @code-reviewer" }, { cwd } as ExtensionContext);

		assert.deepEqual(result, {
			action: "transform",
			text: '/plan use the subagent named "code-reviewer" (spawn it with the safe_subagents tool, agent="code-reviewer", agentScope="both")',
		});
	});
});
