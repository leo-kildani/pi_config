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
type SessionStartHandler = (event: unknown, ctx: ExtensionContext) => void;

function createGuard(flag?: string) {
	let command: CommandRegistration | undefined;
	let toolCall: ToolCallHandler | undefined;
	let sessionStart: SessionStartHandler | undefined;
	const entries: unknown[] = [];
	const pi = {
		registerFlag() {},
		registerCommand: (_name: string, registration: CommandRegistration) => {
			command = registration;
		},
		on: (event: string, handler: any) => {
			if (event === "tool_call") toolCall = handler;
			if (event === "session_start") sessionStart = handler;
		},
		appendEntry: (_type: string, data: unknown) => entries.push(data),
		getFlag: () => flag,
	} as unknown as ExtensionAPI;

	maxBashGuard(pi);
	assert.ok(command);
	assert.ok(toolCall);
	return { command, entries, sessionStart, toolCall };
}

function startSession(sessionStart: SessionStartHandler | undefined, ctx: ExtensionContext, state?: Record<string, unknown>): void {
	assert.ok(sessionStart);
	(ctx as any).sessionManager = {
		getEntries: () => (state ? [{ type: "custom", customType: "max-bash-guard-state", data: state }] : []),
	};
	sessionStart({}, ctx);
}

function createTuiContext(overrides: {
	models?: unknown[];
	renderWidth?: number;
	afterRender?: (component: any) => void;
} = {}) {
	const models = overrides.models ?? [];
	const statuses: string[] = [];
	const ctx = {
		mode: "tui",
		cwd: process.cwd(),
		hasUI: true,
		modelRegistry: { getAvailableOfType: async () => models },
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
				overrides.afterRender?.(component);
				component.render(overrides.renderWidth ?? 80).join("\n");
				component.handleInput("\x1b");
			}),
		},
	} as unknown as ExtensionContext;
	return { ctx, statuses };
}

describe("/maxguard", () => {
	it("shows the mode setting, cycles through modes, and persists each change", async () => {
		const { command, entries } = createGuard();
		const modes: GuardMode[] = ["off", "on", "read-only"];
		const currentIndex = modes.indexOf(DEFAULT_CONFIG.mode);
		const nextModes = Array.from(
			{ length: modes.length },
			(_, step) => modes[(currentIndex + step + 1) % modes.length]!,
		);
		let pickerContent = "";
		const { ctx, statuses } = createTuiContext({
			afterRender: (component) => {
				pickerContent = component.render(80).join("\n");
				for (let index = 0; index < modes.length; index++) component.handleInput("\r");
			},
		});

		await command.handler("", ctx);

		assert.match(pickerContent, /Mode/);
		assert.match(pickerContent, new RegExp(DEFAULT_CONFIG.mode));
		assert.deepEqual(entries.map((entry) => (entry as { mode: GuardMode }).mode), nextModes);
		assert.deepEqual(statuses, nextModes.map((mode) => `${mode === "off" ? "dim" : "success"}:🛡: ${mode}`));
	});

	it("shows only available classifier models and persists the model and checker setting", async () => {
		const { command, entries } = createGuard();
		const models = [
			{ provider: "typesafe", id: "jev-latest" },
			{ provider: "cloudflare-workers-ai", id: "@cf/cloudflare/clef" },
		];
		let initialPickerContent = "";
		let pickerContent = "";
		const { ctx } = createTuiContext({
			models,
			renderWidth: 100,
			afterRender: (component) => {
				initialPickerContent = component.render(100).join("\n");
				component.handleInput("\x1b[B");
				component.handleInput("\x1b[B");
				component.handleInput("\r");
				component.handleInput("\x1b[B");
				component.handleInput("\r");
				pickerContent = component.render(100).join("\n");
			},
		});

		await command.handler("", ctx);

		assert.match(pickerContent, /Checker model/);
		assert.match(initialPickerContent, /typesafe\/jev-latest/);
		assert.match(pickerContent, /cloudflare-workers-ai\/@cf\/cloudflare\/clef/);
		assert.match(pickerContent, /Checker.*off/);
		assert.ok(entries.some((entry) => (entry as { checkerModel?: string }).checkerModel === "cloudflare-workers-ai/@cf/cloudflare/clef"));
		assert.ok(entries.some((entry) => (entry as { checkerEnabled?: boolean }).checkerEnabled === false));
	});

	it("restores the checker model and setting from session state", async () => {
		const { command, sessionStart } = createGuard();
		const models = [
			{ provider: "typesafe", id: "jev-latest" },
			{ provider: "cloudflare-workers-ai", id: "@cf/cloudflare/clef" },
		];
		let pickerContent = "";
		const { ctx } = createTuiContext({
			models,
			renderWidth: 100,
			afterRender: (component) => {
				pickerContent = component.render(100).join("\n");
			},
		});

		startSession(sessionStart, ctx, { mode: "jail", checkerModel: "cloudflare-workers-ai/@cf/cloudflare/clef", checkerEnabled: false });
		await command.handler("", ctx);

		assert.match(pickerContent, /cloudflare-workers-ai\/@cf\/cloudflare\/clef/);
		assert.match(pickerContent, /Checker.*off/);
	});

	it("shows the scope setting and the maxguard.env hint", async () => {
		const { command } = createGuard();
		let pickerContent = "";
		const { ctx } = createTuiContext({
			afterRender: (component) => {
				component.handleInput("\x1b[B");
				component.handleInput("\r");
				pickerContent = component.render(80).join("\n");
			},
		});

		await command.handler("", ctx);

		assert.match(pickerContent, /Scope/);
		assert.match(pickerContent, /custom/);
		assert.match(pickerContent, /set scope in `maxguard.env` using "SCOPE=<path>"/);
	});
});

function createToolContext(options: {
	models?: unknown[];
	classifyReply?: () => Promise<unknown>;
	confirm?: boolean;
} = {}) {
	let checkerCalls = 0;
	let promptCalls = 0;
	const checkedCommands: string[] = [];
	const models = options.models ?? [{ provider: "test", id: "checker" }];
	const ctx = {
		cwd: process.cwd(),
		signal: new AbortController().signal,
		hasUI: true,
		mode: "print",
		modelRegistry: {
			getAvailableOfType: async () => models,
			classify: async (_model: unknown, context: { state: { command: string } }) => {
				checkerCalls++;
				checkedCommands.push(context.state.command);
				return (options.classifyReply ?? (async () => notHarmfulResponse()))();
			},
		},
		ui: {
			setStatus() {},
			theme: { fg: (_color: string, text: string) => text },
			notify() {},
			confirm: async () => {
				promptCalls++;
				return options.confirm ?? false;
			},
		},
	} as unknown as ExtensionContext;
	return { ctx, commands: () => checkedCommands, counts: () => ({ checkerCalls, promptCalls }) };
}

function notHarmfulResponse() {
	return { stopReason: "stop", answers: { verdict: { type: "choice", choice: "NOT_HARMFUL" } } };
}

function errorResponse() {
	return { stopReason: "error", errorMessage: "boom", answers: {} };
}

function harmfulResponse() {
	return { stopReason: "stop", answers: { verdict: { type: "choice", choice: "DATA_DESTRUCTION" } } };
}

describe("off mode tool calls", () => {
	it("allows every command without a checker call or prompt", async () => {
		const { toolCall, sessionStart } = createGuard();
		const { ctx, counts } = createToolContext();
		startSession(sessionStart, ctx, { mode: "off", checkerEnabled: true });

		const decision = await toolCall({ toolName: "bash", input: { command: "rm -rf /" } }, ctx);

		assert.equal(decision, undefined);
		assert.deepEqual(counts(), { checkerCalls: 0, promptCalls: 0 });
	});
});

describe("read-only mode tool calls", () => {
	it("blocks writes without prompts or checker calls", async () => {
		const { toolCall, sessionStart } = createGuard();
		const { ctx, counts } = createToolContext();
		startSession(sessionStart, ctx, { mode: "read-only", checkerEnabled: true });

		const readDecision = await toolCall({ toolName: "bash", input: { command: "cat README.md" } }, ctx);
		const decision = await toolCall({ toolName: "bash", input: { command: "touch AGENTS.md" } }, ctx);

		assert.equal(readDecision, undefined);
		assert.equal(decision?.block, true);
		assert.match(decision!.reason, /write or destructive command/);
		assert.deepEqual(counts(), { checkerCalls: 0, promptCalls: 0 });
	});

	it("blocks an unproven command with the read-only reason", async () => {
		const { toolCall, sessionStart } = createGuard();
		const { ctx, counts } = createToolContext();
		startSession(sessionStart, ctx, { mode: "read-only", checkerEnabled: true });

		const decision = await toolCall({ toolName: "bash", input: { command: "python script.py" } }, ctx);

		assert.equal(decision?.block, true);
		assert.match(decision!.reason, /command is not proven read-only/);
		assert.deepEqual(counts(), { checkerCalls: 0, promptCalls: 0 });
	});
});

describe("on mode tool calls", () => {
	it("allows read-only commands without a checker call", async () => {
		const { toolCall, sessionStart } = createGuard();
		const { ctx, counts } = createToolContext();
		startSession(sessionStart, ctx, { mode: "on", checkerEnabled: true });

		const decision = await toolCall({ toolName: "bash", input: { command: "git status && cat *.md" } }, ctx);

		assert.equal(decision, undefined);
		assert.deepEqual(counts(), { checkerCalls: 0, promptCalls: 0 });
	});

	it("prompts for secret reads in on mode", async () => {
		const { toolCall, sessionStart } = createGuard();
		const { ctx, counts } = createToolContext({ confirm: true });
		startSession(sessionStart, ctx, { mode: "on", checkerEnabled: true });

		const decision = await toolCall({ toolName: "bash", input: { command: "cat .env" } }, ctx);

		assert.equal(decision, undefined);
		assert.deepEqual(counts(), { checkerCalls: 0, promptCalls: 1 });
	});

	it("prompts for a git object secret", async () => {
		const { toolCall, sessionStart } = createGuard();
		const { ctx, counts } = createToolContext({ confirm: false });
		startSession(sessionStart, ctx, { mode: "on", checkerEnabled: true });

		const decision = await toolCall({ toolName: "bash", input: { command: "git show HEAD:.env" } }, ctx);

		assert.equal(decision?.block, true);
		assert.match(decision!.reason, /command reads a secret/);
		assert.deepEqual(counts(), { checkerCalls: 0, promptCalls: 1 });
	});

	it("blocks a destructive secret path with the effect reason", async () => {
		const { toolCall, sessionStart } = createGuard();
		const { ctx, counts } = createToolContext({ confirm: false });
		startSession(sessionStart, ctx, { mode: "on", checkerEnabled: true });

		const decision = await toolCall({ toolName: "bash", input: { command: "rm .env" } }, ctx);

		assert.equal(decision?.block, true);
		assert.match(decision!.reason, /sensitive file \.env/);
		assert.doesNotMatch(decision!.reason, /command reads a secret/);
		assert.deepEqual(counts(), { checkerCalls: 0, promptCalls: 1 });
	});

	it("prompts for write commands without a checker call", async () => {
		const { toolCall, sessionStart } = createGuard();
		const { ctx, counts } = createToolContext({ confirm: false });
		startSession(sessionStart, ctx, { mode: "on", checkerEnabled: true });

		const decision = await toolCall({ toolName: "bash", input: { command: "touch marker" } }, ctx);

		assert.equal(decision?.block, true);
		assert.match(decision!.reason, /User denied/);
		assert.deepEqual(counts(), { checkerCalls: 0, promptCalls: 1 });
	});

	it("prompts for unknown commands when the checker is off", async () => {
		const { toolCall, sessionStart } = createGuard();
		const { ctx, counts } = createToolContext({ confirm: false });
		startSession(sessionStart, ctx, { mode: "on", checkerEnabled: false });

		const decision = await toolCall({ toolName: "bash", input: { command: "python script.py" } }, ctx);

		assert.equal(decision?.block, true);
		assert.match(decision!.reason, /checker is off/);
		assert.deepEqual(counts(), { checkerCalls: 0, promptCalls: 1 });
	});

	it("allows an unknown command when the judge reports no harm", async () => {
		const { toolCall, sessionStart } = createGuard();
		const { ctx, counts } = createToolContext({ classifyReply: async () => notHarmfulResponse() });
		startSession(sessionStart, ctx, { mode: "on", checkerEnabled: true });

		const decision = await toolCall({ toolName: "bash", input: { command: "python script.py" } }, ctx);

		assert.equal(decision, undefined);
		assert.deepEqual(counts(), { checkerCalls: 1, promptCalls: 0 });
	});

	it("checks each unproven command with its own text", async () => {
		const { toolCall, sessionStart } = createGuard();
		const { ctx, commands, counts } = createToolContext({ classifyReply: async () => notHarmfulResponse() });
		startSession(sessionStart, ctx, { mode: "on", checkerEnabled: true });

		const decision = await toolCall({ toolName: "bash", input: { command: "python a.py && python b.py" } }, ctx);

		assert.equal(decision, undefined);
		assert.deepEqual(commands(), ["python a.py", "python b.py"]);
		assert.deepEqual(counts(), { checkerCalls: 2, promptCalls: 0 });
	});

	it("lists every blocked command and reason in one prompt", async () => {
		const { toolCall, sessionStart } = createGuard();
		const { ctx, counts } = createToolContext({ classifyReply: async () => harmfulResponse(), confirm: false });
		startSession(sessionStart, ctx, { mode: "on", checkerEnabled: true });

		const decision = await toolCall({ toolName: "bash", input: { command: "touch marker && python b.py && cat .env" } }, ctx);

		assert.equal(decision?.block, true);
		assert.match(decision!.reason, /1\. write or destructive command/);
		assert.match(decision!.reason, /2\. data destruction/);
		assert.match(decision!.reason, /3\. command reads a secret/);
		assert.match(decision!.reason, /1\. write or destructive command; 2\. data destruction; 3\. command reads a secret/);
		assert.deepEqual(counts(), { checkerCalls: 1, promptCalls: 1 });
	});

	it("shows every blocked command and reason in one TUI prompt", async () => {
		const { toolCall, sessionStart } = createGuard();
		let content = "";
		const { ctx } = createTuiContext({
			afterRender: (component) => {
				content = component.render(120).join("\n");
			},
		});
		startSession(sessionStart, ctx, { mode: "on", checkerEnabled: true });

		const decision = await toolCall({ toolName: "bash", input: { command: "touch marker && cat .env" } }, ctx);

		assert.equal(decision?.block, true);
		assert.match(content, /error:touch marker/);
		assert.match(content, /error:cat \.env/);
		assert.match(content, /warning:1\. write or destructive command/);
		assert.match(content, /warning:2\. command reads a secret/);
		assert.doesNotMatch(content, /warning:touch marker/);
		assert.doesNotMatch(content, /warning:cat \.env/);
	});

	it("prompts when the judge errors", async () => {
		const { toolCall, sessionStart } = createGuard();
		const { ctx, counts } = createToolContext({ classifyReply: async () => errorResponse(), confirm: false });
		startSession(sessionStart, ctx, { mode: "on", checkerEnabled: true });

		const decision = await toolCall({ toolName: "bash", input: { command: "python script.py" } }, ctx);

		assert.equal(decision?.block, true);
		assert.match(decision!.reason, /judge failed: boom/);
		assert.deepEqual(counts(), { checkerCalls: 1, promptCalls: 1 });
	});
});

describe("scope tool calls", () => {
	it("prompts for an out-of-scope path in on mode", async () => {
		const { toolCall, sessionStart } = createGuard();
		const { ctx, counts } = createToolContext();
		startSession(sessionStart, ctx, { mode: "on", checkerEnabled: true, scope: "cwd" });

		const decision = await toolCall({ toolName: "bash", input: { command: "cat /etc/hosts" } }, ctx);

		assert.equal(decision?.block, true);
		assert.match(decision!.reason, /path outside scope/);
		assert.match(decision!.reason, /User denied/);
		assert.deepEqual(counts(), { checkerCalls: 0, promptCalls: 1 });
	});

	it("allows an out-of-scope path when scope is off", async () => {
		const { toolCall, sessionStart } = createGuard();
		const { ctx, counts } = createToolContext();
		startSession(sessionStart, ctx, { mode: "on", checkerEnabled: true, scope: "off" });

		const decision = await toolCall({ toolName: "bash", input: { command: "cat /etc/hosts" } }, ctx);

		assert.equal(decision, undefined);
		assert.deepEqual(counts(), { checkerCalls: 0, promptCalls: 0 });
	});

	it("blocks an out-of-scope path in read-only mode", async () => {
		const { toolCall, sessionStart } = createGuard();
		const { ctx, counts } = createToolContext();
		startSession(sessionStart, ctx, { mode: "read-only", checkerEnabled: true, scope: "cwd" });

		const decision = await toolCall({ toolName: "bash", input: { command: "cat /etc/hosts" } }, ctx);

		assert.equal(decision?.block, true);
		assert.match(decision!.reason, /path outside scope/);
		assert.deepEqual(counts(), { checkerCalls: 0, promptCalls: 0 });
	});

	it("treats a secret read as a secret even when it is out of scope", async () => {
		const { toolCall, sessionStart } = createGuard();
		const { ctx } = createToolContext({ confirm: false });
		startSession(sessionStart, ctx, { mode: "on", checkerEnabled: true, scope: "cwd" });

		const decision = await toolCall({ toolName: "bash", input: { command: "cat /root/.ssh/id_rsa" } }, ctx);

		assert.equal(decision?.block, true);
		assert.match(decision!.reason, /command reads a secret/);
	});
});
