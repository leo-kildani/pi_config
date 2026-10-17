/** Tests for the plan extension widget, argument completions, and command handler. */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import planExtension from "./index.ts";

type SessionStartHandler = (event: unknown, ctx: ExtensionContext) => void;
type LifecycleHandler = (event: { aborted?: boolean }, ctx: ExtensionContext) => void | Promise<void>;
type PlanCommand = {
	getArgumentCompletions?: (prefix: string) => Promise<{ value: string; label: string }[] | null>;
	handler?: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
};

function createPlanExtension() {
	let sessionStart: SessionStartHandler | undefined;
	let command: PlanCommand | undefined;
	const handlers = new Map<string, LifecycleHandler>();
	const appendedEntries: unknown[] = [];
	const sentMessages: string[] = [];
	const pi = {
		registerCommand: (_name: string, registration: PlanCommand) => {
			command = registration;
		},
		on: (event: string, handler: LifecycleHandler) => {
			if (event === "session_start") sessionStart = handler as SessionStartHandler;
			handlers.set(event, handler);
		},
		appendEntry: (_type: string, data: unknown) => {
			appendedEntries.push(data);
		},
		sendUserMessage: (message: string) => {
			sentMessages.push(message);
		},
	} as unknown as ExtensionAPI;

	planExtension(pi);
	assert.ok(sessionStart);
	assert.ok(command);
	return { sessionStart, command, handlers, appendedEntries, sentMessages };
}

function createContext(phase: "pending" | "built", cwd = "/agent", selectValue?: string) {
	const widgets: unknown[][] = [];
	const notifications: string[] = [];
	const state = {
		sessionId: "session-1",
		planPath: "/agent/plans/demo.md",
		phase,
		widgetVisible: true,
	};
	const ctx = {
		cwd,
		hasUI: true,
		isIdle: () => true,
		sessionManager: {
			getSessionId: () => "session-1",
			getBranch: () => [{ type: "custom", customType: "plan-state", data: state }],
		},
		ui: {
			theme: { fg: (color: string, text: string) => `${color}:${text}` },
			notify: (message: string) => notifications.push(message),
			input: async () => undefined,
			select: async () => selectValue,
			setWidget: (_key: string, content: unknown[] | undefined) => {
				if (content) widgets.push(content);
			},
		},
	} as unknown as ExtensionContext;
	return { ctx, widgets, notifications };
}

describe("Current Plan widget", () => {
	it("shows the plan path first and status second with their theme colors", () => {
		const { sessionStart } = createPlanExtension();

		for (const phase of ["pending", "built"] as const) {
			const { ctx, widgets } = createContext(phase);
			sessionStart({}, ctx);
			assert.deepEqual(widgets, [[
				"accent:Current Plan: /agent/plans/demo.md",
				`muted:Status: ${phase}`,
			]]);
		}
	});
});

describe("plan argument completions", () => {
	it("completes the template and set subcommands", async () => {
		const { command } = createPlanExtension();
		assert.deepEqual(await command.getArgumentCompletions?.("se"), [{ value: "set", label: "set" }]);
		assert.deepEqual(await command.getArgumentCompletions?.("temp"), [{ value: "template", label: "template" }]);
	});

	it("lists project plan files for the set prefix", async () => {
		const directory = await mkdtemp(join(tmpdir(), "pi-plan-"));
		try {
			await mkdir(join(directory, ".plans"), { recursive: true });
			await writeFile(join(directory, ".plans", "api-backend.md"), "x");
			const { sessionStart, command } = createPlanExtension();
			const { ctx } = createContext("pending", directory);
			sessionStart({}, ctx);

			assert.deepEqual(await command.getArgumentCompletions?.("set "), [
				{ value: "set api-backend.md", label: "api-backend.md" },
			]);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});
});

describe("plan build completion", () => {
	it("does not mark a build complete at agent_end", async () => {
		const { sessionStart, command, handlers, appendedEntries } = createPlanExtension();
		const { ctx, notifications } = createContext("pending");
		sessionStart({}, ctx);
		await command.handler?.("build", ctx as never);

		await handlers.get("agent_end")?.({}, ctx);

		assert.deepEqual(appendedEntries, []);
		assert.ok(!notifications.includes("Current Plan Built"));
	});

	it("keeps an aborted build pending at settlement", async () => {
		const { sessionStart, command, handlers, appendedEntries } = createPlanExtension();
		const { ctx, widgets, notifications } = createContext("pending");
		sessionStart({}, ctx);
		await command.handler?.("build", ctx as never);
		await handlers.get("agent_end")?.({}, ctx);
		await handlers.get("agent_settled")?.({ aborted: true }, ctx);

		assert.deepEqual(appendedEntries, []);
		assert.equal(widgets.at(-1)?.[1], "muted:Status: pending");
		assert.ok(!notifications.includes("Current Plan Built"));
	});

	it("marks a non-aborted settled build built", async () => {
		const { sessionStart, command, handlers, appendedEntries } = createPlanExtension();
		const { ctx, widgets, notifications } = createContext("pending");
		sessionStart({}, ctx);
		await command.handler?.("build", ctx as never);
		await handlers.get("agent_end")?.({}, ctx);
		assert.deepEqual(appendedEntries, []);
		await handlers.get("agent_settled")?.({ aborted: false }, ctx);

		assert.deepEqual(appendedEntries, [{
			sessionId: "session-1",
			planPath: "/agent/plans/demo.md",
			phase: "built",
			widgetVisible: true,
		}]);
		assert.equal(widgets.at(-1)?.[1], "muted:Status: built");
		assert.ok(notifications.includes("Current Plan Built"));
	});
});

describe("plan command handler", () => {
	it("creates generated plans under <cwd>/.plans", async () => {
		const directory = await mkdtemp(join(tmpdir(), "pi-plan-"));
		try {
			const { sessionStart, command, sentMessages } = createPlanExtension();
			const { ctx, widgets } = createContext("built", directory);
			sessionStart({}, ctx);

			await command.handler?.("Add project plan directory", ctx as never);

			const planPath = join(directory, ".plans", "add-project-plan-session-1.md");
			assert.equal((await stat(join(directory, ".plans"))).isDirectory(), true);
			assert.ok(sentMessages.at(-1)?.includes(planPath));
			assert.equal(widgets.at(-1)?.[0], `accent:Current Plan: ${planPath}`);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});

	it("adds a numeric suffix when a generated plan name collides", async () => {
		const directory = await mkdtemp(join(tmpdir(), "pi-plan-"));
		try {
			await mkdir(join(directory, ".plans"), { recursive: true });
			await writeFile(join(directory, ".plans", "add-project-plan-session-1.md"), "existing");
			const { sessionStart, command, sentMessages } = createPlanExtension();
			const { ctx } = createContext("built", directory);
			sessionStart({}, ctx);

			await command.handler?.("Add project plan directory", ctx as never);

			assert.ok(sentMessages.at(-1)?.includes(join(directory, ".plans", "add-project-plan-session-1-2.md")));
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});

	it("/plan template writes the template file and does not change the plan", async () => {
		const directory = await mkdtemp(join(tmpdir(), "pi-plan-"));
		try {
			const { sessionStart, command } = createPlanExtension();
			const { ctx, notifications } = createContext("pending", directory);
			sessionStart({}, ctx);

			await command.handler?.("template api-backend", ctx as never);

			const content = await readFile(join(directory, ".plans", "api-backend.md"), "utf8");
			assert.match(content, /## Workflows/);
			assert.match(content, /### <Workflow Name>/);
			assert.ok(notifications.some((message) => message.includes("api-backend.md")));
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});

	it("/plan set makes the file current and shows it in the widget", async () => {
		const directory = await mkdtemp(join(tmpdir(), "pi-plan-"));
		try {
			const { sessionStart, command } = createPlanExtension();
			const { ctx, widgets } = createContext("pending", directory);
			sessionStart({}, ctx);

			await command.handler?.("template api-backend", ctx as never);
			await command.handler?.("set api-backend.md", ctx as never);

			assert.deepEqual(widgets.at(-1), [
				`accent:Current Plan: ${join(directory, ".plans", "api-backend.md")}`,
				"muted:Status: pending",
			]);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});

	it("adds a numeric suffix when a template name collides", async () => {
		const directory = await mkdtemp(join(tmpdir(), "pi-plan-"));
		try {
			const { sessionStart, command } = createPlanExtension();
			const { ctx } = createContext("pending", directory);
			sessionStart({}, ctx);

			await command.handler?.("template api-backend", ctx as never);
			await command.handler?.("template api-backend", ctx as never);

			await readFile(join(directory, ".plans", "api-backend-2.md"), "utf8");
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});

	it("uses the select list when set has no argument", async () => {
		const directory = await mkdtemp(join(tmpdir(), "pi-plan-"));
		try {
			const { sessionStart, command } = createPlanExtension();
			const { ctx, widgets } = createContext("pending", directory, "api-backend.md");
			sessionStart({}, ctx);

			await command.handler?.("template api-backend", ctx as never);
			await command.handler?.("set", ctx as never);

			assert.equal(widgets.at(-1)?.[0], `accent:Current Plan: ${join(directory, ".plans", "api-backend.md")}`);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});

	it("/plan build sends the build prompt for the set plan", async () => {
		const directory = await mkdtemp(join(tmpdir(), "pi-plan-"));
		try {
			const { sessionStart, command, sentMessages } = createPlanExtension();
			const { ctx } = createContext("pending", directory);
			sessionStart({}, ctx);

			await command.handler?.("template api-backend", ctx as never);
			await command.handler?.("set api-backend.md", ctx as never);
			await command.handler?.("build", ctx as never);

			const prompt = sentMessages.at(-1) ?? "";
			assert.match(prompt, /PLAN-BUILD MODE/);
			assert.ok(prompt.includes(join(directory, ".plans", "api-backend.md")));
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});

	it("sets a plan from an absolute path outside .plans", async () => {
		const directory = await mkdtemp(join(tmpdir(), "pi-plan-"));
		try {
			const agentPlans = join(directory, "agent-plans");
			await mkdir(agentPlans, { recursive: true });
			const target = join(agentPlans, "old-plan.md");
			await writeFile(target, "x");
			const { sessionStart, command } = createPlanExtension();
			const { ctx, widgets } = createContext("pending", directory);
			sessionStart({}, ctx);

			await command.handler?.(`set ${target}`, ctx as never);

			assert.equal(widgets.at(-1)?.[0], `accent:Current Plan: ${target}`);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});
});
