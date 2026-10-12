/**
 * Unit tests for resource resolution, agent discovery, and child CLI arguments.
 * Runs with the Node built-in test runner, no dependencies:
 *   node --experimental-strip-types --test agents.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
	buildExtensionArgs,
	discoverAgents,
	listExtensionNames,
	listSkillNames,
	resolveExtensionPaths,
	resolveSkillPaths,
} from "./agents.ts";

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
	it("reads a comma separated extensions list", () => {
		const dir = writeAgent("---\nname: a\ndescription: d\nextensions: ./guard.ts, ./search.ts\n---\nBody\n");
		assert.deepEqual(discoverAgents(dir, "project").agents[0].extensions, ["./guard.ts", "./search.ts"]);
	});

	it("loads no extensions when the key is absent", () => {
		const dir = writeAgent("---\nname: a\ndescription: d\n---\nBody\n");
		assert.deepEqual(discoverAgents(dir, "project").agents[0].extensions, []);
	});

	it("reads model and thinking overrides", () => {
		const dir = writeAgent("---\nname: a\ndescription: d\nmodel: gpt-6-luna\nthinking: low\n---\nBody\n");
		const agent = discoverAgents(dir, "project").agents[0];
		assert.equal(agent.model, "gpt-6-luna");
		assert.equal(agent.thinking, "low");
	});

	it("reads quoted package/resource selectors", () => {
		const dir = writeAgent(
			'---\nname: a\ndescription: d\nextensions: "@ff-labs/pi-fff:src, @leo-kildani/pi_config:max-bash-guard"\n---\nBody\n',
		);
		assert.deepEqual(discoverAgents(dir, "project").agents[0].extensions, [
			"@ff-labs/pi-fff:src",
			"@leo-kildani/pi_config:max-bash-guard",
		]);
	});

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

describe("resolveExtensionPaths", () => {
	const sources = [
		{
			sourceInfo: {
				path: "/packages/pi-fff/src/index.ts",
				source: "npm:@ff-labs/pi-fff",
				baseDir: "/packages/pi-fff",
			},
		},
		{
			sourceInfo: {
				path: "/packages/pi-fff/src/index.ts",
				source: "npm:@ff-labs/pi-fff",
				baseDir: "/packages/pi-fff",
			},
		},
		{
			sourceInfo: {
				path: "/packages/pi_config/extensions/max-bash-guard/index.ts",
				source: "git:github.com/leo-kildani/pi_config",
				baseDir: "/packages/pi_config",
			},
		},
	];

	it("maps package/resource selectors to paths from loaded extensions", () => {
		assert.deepEqual(resolveExtensionPaths([
			"@ff-labs/pi-fff",
			"@ff-labs/pi-fff:src",
			"@leo-kildani/pi_config:max-bash-guard",
		], sources), {
			paths: ["/packages/pi-fff/src/index.ts", "/packages/pi_config/extensions/max-bash-guard/index.ts"],
			unknown: [],
			ambiguous: [],
		});
	});

	it("lists the available selectors", () => {
		assert.deepEqual(listExtensionNames(sources), [
			"@ff-labs/pi-fff",
			"@ff-labs/pi-fff:src",
			"@leo-kildani/pi_config",
			"@leo-kildani/pi_config:max-bash-guard",
		]);
	});

	it("reports unknown and ambiguous selectors", () => {
		const result = resolveExtensionPaths(["@missing/package", "@example/pkg:guard"], [
			{
				sourceInfo: {
					path: "/packages/pkg/extensions/guard/index.ts",
					source: "npm:@example/pkg",
					baseDir: "/packages/pkg",
				},
			},
			{
				sourceInfo: {
					path: "/packages/pkg/extensions/guard.ts",
					source: "npm:@example/pkg",
					baseDir: "/packages/pkg",
				},
			},
		]);

		assert.deepEqual(result, {
			paths: [],
			unknown: ["@missing/package"],
			ambiguous: [{
				name: "@example/pkg:guard",
				paths: ["/packages/pkg/extensions/guard/index.ts", "/packages/pkg/extensions/guard.ts"],
			}],
		});
	});

	it("keeps explicit extension paths", () => {
		assert.deepEqual(resolveExtensionPaths(["~/.pi/agent/extensions/guard.ts", "builtin:mcp"], []), {
			paths: ["~/.pi/agent/extensions/guard.ts", "builtin:mcp"],
			unknown: [],
			ambiguous: [],
		});
	});
});

describe("buildExtensionArgs", () => {
	it("disables discovered extensions and loads only the declared extensions", () => {
		assert.deepEqual(buildExtensionArgs(["./guard.ts", "./search.ts"]), [
			"--no-extensions",
			"--extension",
			"./guard.ts",
			"--extension",
			"./search.ts",
		]);
		assert.deepEqual(buildExtensionArgs([]), ["--no-extensions"]);
	});
});
