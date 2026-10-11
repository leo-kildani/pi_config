/**
 * Tests for the /maxguard command completions and footer status.
 * Run with:
 *   node --experimental-strip-types --test extensions/max-bash-guard/index.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import maxBashGuard from "./index.ts";

type Completion = { value: string; label: string };
type CommandRegistration = {
	getArgumentCompletions?: (prefix: string) => Completion[] | null;
	handler: (args: string, ctx: ExtensionContext) => Promise<void>;
};

type ToolCallHandler = (event: { toolName: string; input: { command: string } }, ctx: ExtensionContext) => Promise<{ block: boolean; reason: string } | void>;

function createGuard() {
	let command: CommandRegistration | undefined;
	let flagDefault: unknown;
	let toolCall: ToolCallHandler | undefined;
	const pi = {
		registerFlag: (_name: string, options: { default?: unknown }) => {
			flagDefault = options.default;
		},
		registerCommand: (_name: string, options: CommandRegistration) => {
			command = options;
		},
		on: (event: string, handler: ToolCallHandler) => {
			if (event === "tool_call") toolCall = handler;
		},
		appendEntry: () => {},
		getFlag: () => undefined,
	} as unknown as ExtensionAPI;

	maxBashGuard(pi);
	assert.ok(command);
	assert.ok(toolCall);
	return { command, flagDefault, toolCall };
}

describe("/maxguard argument completions", () => {
	it("suggests guard modes that match the argument prefix", () => {
		const { command, flagDefault } = createGuard();

		assert.equal(flagDefault, "read-only");
		assert.deepEqual(command.getArgumentCompletions?.(""), [
			{ value: "free", label: "free" },
			{ value: "trial", label: "trial" },
			{ value: "jail", label: "jail" },
			{ value: "read-only", label: "read-only" },
		]);
		assert.deepEqual(command.getArgumentCompletions?.("TR"), [
			{ value: "trial", label: "trial" },
		]);
		assert.deepEqual(command.getArgumentCompletions?.("READ"), [
			{ value: "read-only", label: "read-only" },
		]);
		assert.equal(command.getArgumentCompletions?.("unknown"), null);
	});
});

describe("read-only mode tool calls", () => {
	it("blocks writes without prompts or checker calls", async () => {
		const { toolCall } = createGuard();
		let checkerCalls = 0;
		let promptCalls = 0;
		const ctx = {
			cwd: process.cwd(),
			signal: new AbortController().signal,
			hasUI: true,
			mode: "tui",
			model: { provider: "test", id: "test" },
			scopedModels: [],
			modelRegistry: {
				hasConfiguredAuth: () => {
					checkerCalls++;
					return true;
				},
				complete: async () => ({ stopReason: "stop", content: [{ type: "text", text: "SAFE" }] }),
			},
			ui: {
				setStatus: () => {},
				theme: { fg: (_color: string, text: string) => text },
				notify: () => {},
				confirm: async () => {
					promptCalls++;
					return true;
				},
			},
		} as unknown as ExtensionContext;

		const readDecision = await toolCall({ toolName: "bash", input: { command: "cat README.md" } }, ctx);
		const decision = await toolCall({ toolName: "bash", input: { command: "touch AGENTS.md" } }, ctx);

		assert.equal(readDecision, undefined);
		assert.equal(decision?.block, true);
		assert.equal(checkerCalls, 0);
		assert.equal(promptCalls, 0);
	});
});

describe("/maxguard footer status", () => {
	it("shows each selected mode with the shield and its existing color", async () => {
		const { command } = createGuard();
		const statuses: string[] = [];
		const ctx = {
			ui: {
				setStatus: (_key: string, text: string) => statuses.push(text),
				theme: { fg: (color: string, text: string) => `${color}:${text}` },
				notify: () => {},
			},
		} as unknown as ExtensionContext;

		for (const mode of ["free", "trial", "jail", "read-only"]) {
			await command.handler(mode, ctx);
		}

		assert.deepEqual(statuses, [
			"dim:🛡: free",
			"success:🛡: trial",
			"success:🛡: jail",
			"success:🛡: read-only",
		]);
	});
});
