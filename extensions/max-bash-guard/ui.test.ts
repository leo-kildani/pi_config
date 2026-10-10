/**
 * Unit tests for ui.ts, the highlighted command renderer and the key mapper.
 * Runs with the Node built-in test runner:
 *   node --experimental-strip-types --test extensions/max-bash-guard/ui.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { decisionForKey, renderHighlightedCommand, type HighlightTheme } from "./ui.ts";

const theme: HighlightTheme = {
	bold: (text) => `**${text}**`,
	fg: (color, text) => `<${color}>${text}</${color}>`,
};

describe("renderHighlightedCommand", () => {
	it("returns the command unchanged when no span is destructive", () => {
		assert.equal(renderHighlightedCommand("echo x && ls", [], theme), "echo x && ls");
	});

	it("keeps the full command and highlights the destructive span", () => {
		const command = "echo x && rm -rf / && ls";
		const rendered = renderHighlightedCommand(command, [{ text: "rm -rf /", start: 10, end: 18 }], theme);
		assert.equal(rendered, "echo x && <error>**rm -rf /**</error> && ls");
	});

	it("highlights a span at the start of the command", () => {
		const rendered = renderHighlightedCommand("rm -rf /", [{ text: "rm -rf /", start: 0, end: 8 }], theme);
		assert.equal(rendered, "<error>**rm -rf /**</error>");
	});

	it("sorts spans that arrive out of order", () => {
		const command = "rm a && rm b";
		const rendered = renderHighlightedCommand(command, [
			{ text: "rm b", start: 8, end: 12 },
			{ text: "rm a", start: 0, end: 4 },
		], theme);
		assert.equal(rendered, "<error>**rm a**</error> && <error>**rm b**</error>");
	});
});

describe("decisionForKey", () => {
	it("allows on y", () => {
		assert.equal(decisionForKey("y"), true);
		assert.equal(decisionForKey("Y"), true);
	});

	it("denies on n", () => {
		assert.equal(decisionForKey("n"), false);
		assert.equal(decisionForKey("N"), false);
	});

	it("returns undefined for another key", () => {
		assert.equal(decisionForKey("x"), undefined);
		assert.equal(decisionForKey("\r"), undefined);
		assert.equal(decisionForKey("\x1b"), undefined);
	});
});
