/** Tests for the max-bash-guard command UI and tool-call behavior. */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { DEFAULT_CONFIG, type GuardMode } from "./config.ts";
import maxBashGuard from "./index.ts";

type CommandRegistration = {
	handler: (args: string, ctx: ExtensionContext) => Promise<void>;
};

type ToolCallHandler = (
	event: { toolName: string; input: { command: string } },
	ctx: ExtensionContext,
) => Promise<{ block: boolean; reason: string } | void>;

function createGuard() {
	let command: CommandRegistration | undefined;
	let toolCall: ToolCallHandler | undefined;
	const entries: unknown[] = [];
	const pi = {
		registerFlag() {},
		registerCommand: (_name: string, registration: CommandRegistration) => {
			command = registration;
		},
		on: (event: string, handler: ToolCallHandler) => {
			if (event === "tool_call") toolCall = handler;
		},
		appendEntry: (_type: string, data: unknown) => entries.push(data),
		getFlag: () => undefined,
	} as unknown as ExtensionAPI;

	maxBashGuard(pi);
	assert.ok(command);
	assert.ok(toolCall);
	return { command, entries, toolCall };
}

describe("/maxguard", () => {
	it("shows the mode setting, cycles through modes, and persists each change", async () => {
		const { command, entries } = createGuard();
		const modes: GuardMode[] = ["free", "trial", "jail", "read-only"];
		const currentIndex = modes.indexOf(DEFAULT_CONFIG.mode);
		const nextModes = Array.from(
			{ length: modes.length },
			(_, step) => modes[(currentIndex + step + 1) % modes.length]!,
		);
		const statuses: string[] = [];
		let pickerContent = "";
		const ctx = {
			mode: "tui",
			cwd: process.cwd(),
			hasUI: true,
			ui: {
				notify() {},
				setStatus: (_key: string, text: string) => statuses.push(text),
				theme: { fg: (color: string, text: string) => `${color}:${text}` },
				custom: async (
					factory: (tui: any, theme: any, keybindings: any, done: (value?: unknown) => void) => any,
				) => new Promise((resolve) => {
					const theme = {
						fg: (color: string, text: string) => `${color}:${text}`,
						bold: (text: string) => text,
					};
					const component = factory({ requestRender() {} }, theme, {}, resolve);
					pickerContent = component.render(80).join("\n");
					for (let index = 0; index < modes.length; index++) component.handleInput("\r");
					component.handleInput("\x1b");
				}),
			},
		} as unknown as ExtensionContext;

		await command.handler("", ctx);

		assert.match(pickerContent, /Mode/);
		assert.match(pickerContent, new RegExp(DEFAULT_CONFIG.mode));
		assert.deepEqual(entries.map((entry) => (entry as { mode: GuardMode }).mode), nextModes);
		assert.deepEqual(statuses, nextModes.map((mode) => `${mode === "free" ? "dim" : "success"}:🛡: ${mode}`));
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
