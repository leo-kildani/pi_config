/**
 * Unit tests for the skill resolution and agent discovery of safe-subagents.
 * Runs with the Node built-in test runner, no dependencies:
 *   node --experimental-strip-types --test agents.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { discoverAgents, listSkillNames, resolveSkillPaths } from "./agents.ts";

const commands = [
	{
		name: "skill:ponytail",
		source: "skill" as const,
		sourceInfo: { path: "/skills/ponytail/SKILL.md", source: "local", scope: "user" as const, origin: "top-level" as const },
	},
	{
		name: "skill:writing-in-ste",
		source: "skill" as const,
		sourceInfo: { path: "/skills/writing-in-ste/SKILL.md", source: "local", scope: "user" as const, origin: "top-level" as const },
	},
	{
		name: "review",
		source: "prompt" as const,
		sourceInfo: { path: "/prompts/review.md", source: "local", scope: "user" as const, origin: "top-level" as const },
	},
];

describe("resolveSkillPaths", () => {
	it("maps declared names to the paths of the parent session", () => {
		assert.deepEqual(resolveSkillPaths(["ponytail", "writing-in-ste"], commands).paths, [
			"/skills/ponytail/SKILL.md",
			"/skills/writing-in-ste/SKILL.md",
		]);
	});

	it("reports names the parent cannot resolve as unknown", () => {
		const res = resolveSkillPaths(["ponytail", "nope"], commands);
		assert.deepEqual(res.paths, ["/skills/ponytail/SKILL.md"]);
		assert.deepEqual(res.unknown, ["nope"]);
	});

	it("ignores commands that are not skills", () => {
		assert.deepEqual(resolveSkillPaths(["review"], commands).unknown, ["review"]);
	});

	it("returns nothing for a declared empty list", () => {
		assert.deepEqual(resolveSkillPaths([], commands), { paths: [], unknown: [] });
	});

	it("lists every resolvable skill name, sorted", () => {
		assert.deepEqual(listSkillNames(commands), ["ponytail", "writing-in-ste"]);
	});
});

function writeAgent(body: string): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "safe-subagents-test-"));
	fs.mkdirSync(path.join(dir, ".pi", "agents"), { recursive: true });
	fs.writeFileSync(path.join(dir, ".pi", "agents", "agent.md"), body);
	return dir;
}

describe("discoverAgents", () => {
	it("reads a comma separated skills list", () => {
		const dir = writeAgent("---\nname: a\ndescription: d\nskills: ponytail, writing-in-ste\n---\nBody\n");
		assert.deepEqual(discoverAgents(dir, "project").agents[0].skills, ["ponytail", "writing-in-ste"]);
	});

	it("reads a skills array", () => {
		const dir = writeAgent("---\nname: a\ndescription: d\nskills: [ponytail]\n---\nBody\n");
		assert.deepEqual(discoverAgents(dir, "project").agents[0].skills, ["ponytail"]);
	});

	it("loads no skills when the key is absent", () => {
		const dir = writeAgent("---\nname: a\ndescription: d\n---\nBody\n");
		assert.deepEqual(discoverAgents(dir, "project").agents[0].skills, []);
	});

	it("loads no skills when the value is not a name list", () => {
		const dir = writeAgent("---\nname: a\ndescription: d\nskills:\n  ponytail: true\n---\nBody\n");
		assert.deepEqual(discoverAgents(dir, "project").agents[0].skills, []);
	});
});
