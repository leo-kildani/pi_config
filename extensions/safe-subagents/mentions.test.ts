/** Unit tests for agent mention autocomplete. */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AutocompleteProvider } from "@earendil-works/pi-tui";
import type { AgentConfig } from "./agents.ts";
import { createAgentMentionProvider } from "./mentions.ts";

function agent(name: string, source: "user" | "project" = "user"): AgentConfig {
	return {
		name,
		description: `${name} agent`,
		extensions: [],
		skills: [],
		systemPrompt: "",
		source,
		filePath: `/${name}.md`,
	};
}

function provider(overrides: Partial<AutocompleteProvider> = {}): AutocompleteProvider {
	return {
		getSuggestions: async () => null,
		applyCompletion: (lines, cursorLine, cursorCol, item, prefix) => ({
			lines: [item.value],
			cursorLine,
			cursorCol: prefix.length,
		}),
		...overrides,
	};
}

async function suggest(current: AutocompleteProvider, line: string, agents: AgentConfig[]) {
	return createAgentMentionProvider(current, () => agents).getSuggestions(
		[line],
		0,
		line.length,
		{ signal: new AbortController().signal },
	);
}

describe("createAgentMentionProvider", () => {
	it("puts matching agent rows before Pi's file rows", async () => {
		const files = { items: [{ value: "@src/index.ts", label: "src/index.ts" }], prefix: "@ex" };
		const result = await suggest(provider({ getSuggestions: async () => files }), "@ex", [agent("explorer")]);

		assert.deepEqual(result, {
			items: [
				{ value: "@explorer", label: "@explorer", description: "explorer agent" },
				...files.items,
			],
			prefix: "@ex",
		});
	});

	it("offers all matching agents for a bare @ and keeps file rows", async () => {
		const files = { items: [{ value: "@src/index.ts", label: "src/index.ts" }], prefix: "@" };
		const result = await suggest(provider({ getSuggestions: async () => files }), "@", [agent("explorer"), agent("reviewer")]);

		assert.deepEqual(result?.items.map((item) => item.value), ["@explorer", "@reviewer", "@src/index.ts"]);
	});

	it("matches handle prefixes without regard to case", async () => {
		const result = await suggest(provider(), "@EX", [agent("explorer")]);

		assert.deepEqual(result?.items.map((item) => item.value), ["@explorer"]);
		assert.equal(result?.prefix, "@EX");
	});

	it("keeps Pi's file suggestions when no agent matches", async () => {
		const files = { items: [{ value: "@src/index.ts", label: "src/index.ts" }], prefix: "@zz" };
		const result = await suggest(provider({ getSuggestions: async () => files }), "@zz", [agent("explorer")]);

		assert.equal(result, files);
	});

	it("uses supported token boundaries", async () => {
		const current = provider();
		const wrapped = createAgentMentionProvider(current, () => [agent("explorer")]);
		const invalid = await wrapped.getSuggestions(["path/@ex"], 0, 8, { signal: new AbortController().signal });
		const cjk = await wrapped.getSuggestions(["。@ex"], 0, 4, { signal: new AbortController().signal });

		assert.equal(invalid, null);
		assert.deepEqual(cjk?.items.map((item) => item.value), ["@explorer"]);
	});

	it("delegates completion application and file-completion checks", () => {
		const applied = { lines: ["done"], cursorLine: 0, cursorCol: 4 };
		let appliedArgs: unknown[] | undefined;
		let checkedArgs: unknown[] | undefined;
		const current = provider({
			applyCompletion: (...args) => {
				appliedArgs = args;
				return applied;
			},
			shouldTriggerFileCompletion: (...args) => {
				checkedArgs = args;
				return false;
			},
		});
		const wrapped = createAgentMentionProvider(current, () => [agent("explorer")]);
		const item = { value: "@explorer", label: "@explorer" };

		assert.equal(wrapped.applyCompletion(["@ex"], 0, 3, item, "@ex"), applied);
		assert.equal(wrapped.shouldTriggerFileCompletion?.(["@ex"], 0, 3), false);
		assert.deepEqual(appliedArgs, [["@ex"], 0, 3, item, "@ex"]);
		assert.deepEqual(checkedArgs, [["@ex"], 0, 3]);
	});
});
