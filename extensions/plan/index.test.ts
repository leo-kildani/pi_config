/** Tests for the plan extension widget. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import planExtension from "./index.ts";

type SessionStartHandler = (event: unknown, ctx: ExtensionContext) => void;

function createPlanExtension() {
	let sessionStart: SessionStartHandler | undefined;
	const pi = {
		registerCommand() {},
		on: (event: string, handler: SessionStartHandler) => {
			if (event === "session_start") sessionStart = handler;
		},
		appendEntry() {},
		sendUserMessage() {},
	} as unknown as ExtensionAPI;

	planExtension(pi);
	assert.ok(sessionStart);
	return sessionStart;
}

function createContext(phase: "pending" | "built") {
	const widgets: unknown[][] = [];
	const state = {
		sessionId: "session-1",
		planPath: "/agent/plans/demo.md",
		phase,
		widgetVisible: true,
	};
	const ctx = {
		sessionManager: {
			getSessionId: () => "session-1",
			getBranch: () => [{ type: "custom", customType: "plan-state", data: state }],
		},
		ui: {
			theme: { fg: (color: string, text: string) => `${color}:${text}` },
			setWidget: (_key: string, content: unknown[] | undefined) => {
				if (content) widgets.push(content);
			},
		},
	} as unknown as ExtensionContext;
	return { ctx, widgets };
}

describe("Current Plan widget", () => {
	it("shows the plan path first and status second with their theme colors", () => {
		const sessionStart = createPlanExtension();

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
