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

function createCommand(): CommandRegistration {
	let command: CommandRegistration | undefined;
	const pi = {
		registerFlag: () => {},
		registerCommand: (_name: string, options: CommandRegistration) => {
			command = options;
		},
		on: () => {},
		appendEntry: () => {},
		getFlag: () => undefined,
	} as unknown as ExtensionAPI;

	maxBashGuard(pi);
	assert.ok(command);
	return command;
}

describe("/maxguard argument completions", () => {
	it("suggests guard modes that match the argument prefix", () => {
		const command = createCommand();

		assert.deepEqual(command.getArgumentCompletions?.(""), [
			{ value: "free", label: "free" },
			{ value: "trial", label: "trial" },
			{ value: "jail", label: "jail" },
		]);
		assert.deepEqual(command.getArgumentCompletions?.("TR"), [
			{ value: "trial", label: "trial" },
		]);
		assert.equal(command.getArgumentCompletions?.("unknown"), null);
	});
});

describe("/maxguard footer status", () => {
	it("shows each selected mode with the shield and its existing color", async () => {
		const command = createCommand();
		const statuses: string[] = [];
		const ctx = {
			ui: {
				setStatus: (_key: string, text: string) => statuses.push(text),
				theme: { fg: (color: string, text: string) => `${color}:${text}` },
				notify: () => {},
			},
		} as unknown as ExtensionContext;

		for (const mode of ["free", "trial", "jail"]) {
			await command.handler(mode, ctx);
		}

		assert.deepEqual(statuses, [
			"dim:🛡: free",
			"success:🛡: trial",
			"success:🛡: jail",
		]);
	});
});
