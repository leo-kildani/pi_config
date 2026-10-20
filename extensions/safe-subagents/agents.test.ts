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
	findMentionedAgents,
	listExtensionNames,
	listSkillNames,
	replaceAgentMentions,
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

function testAgent(name: string, source: "user" | "project" = "user") {
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

function writeAgent(body: string): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "safe-subagents-test-"));
	fs.mkdirSync(path.join(dir, ".pi", "agents"), { recursive: true });
	fs.writeFileSync(path.join(dir, ".pi", "agents", "agent.md"), body);
	return dir;
}

describe("discoverAgents", () => {
	it("lets a project agent override a user agent with the same name in both scope", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "safe-subagents-test-"));
		const agentDir = path.join(root, "user-agent");
		const projectDir = path.join(root, "project");
		fs.mkdirSync(path.join(agentDir, "agents"), { recursive: true });
		fs.mkdirSync(path.join(projectDir, ".pi", "agents"), { recursive: true });
		fs.writeFileSync(path.join(agentDir, "agents", "shared.md"), "---\nname: shared\ndescription: user\n---\nUser body\n");
		fs.writeFileSync(path.join(projectDir, ".pi", "agents", "shared.md"), "---\nname: shared\ndescription: project\n---\nProject body\n");

		const previous = process.env.PI_CODING_AGENT_DIR;
		process.env.PI_CODING_AGENT_DIR = agentDir;
		try {
			const agent = discoverAgents(projectDir, "both").agents[0];
			assert.equal(agent.source, "project");
			assert.equal(agent.description, "project");
		} finally {
			if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
			else process.env.PI_CODING_AGENT_DIR = previous;
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

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
			'---\nname: a\ndescription: d\nextensions: "@ff-labs/pi-fff:src, @leo-kildani/pi_config:plan"\n---\nBody\n',
		);
		assert.deepEqual(discoverAgents(dir, "project").agents[0].extensions, [
			"@ff-labs/pi-fff:src",
			"@leo-kildani/pi_config:plan",
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

describe("findMentionedAgents", () => {
	it("finds known handles anywhere in the message and keeps first-seen unique order", () => {
		const agents = [testAgent("code-reviewer"), testAgent("explorer", "project")];

		assert.deepEqual(
			findMentionedAgents("Have @code-reviewer review this, then ask @explorer. @code-reviewer again", agents),
			[agents[0], agents[1]],
		);
	});

	it("matches known names without regard to case", () => {
		const agents = [testAgent("code-reviewer")];

		assert.deepEqual(findMentionedAgents("Have @CODE-REVIEWER review this", agents), agents);
	});

	it("ignores unknown handles and path-like tokens", () => {
		const agents = [testAgent("src"), testAgent("reviewer")];

		assert.deepEqual(findMentionedAgents("Read @src/index.ts and ask @unknown", agents), []);
	});

	it("returns no agents when the message has no known handle", () => {
		assert.deepEqual(findMentionedAgents("Review the latest feature", [testAgent("reviewer")]), []);
	});
});

describe("replaceAgentMentions", () => {
	it("keeps the main-agent text and replaces only the mention token", () => {
		const agents = [testAgent("explorer")];

		assert.equal(
			replaceAgentMentions("clone the repo then have @explorer inspect it", agents),
			'clone the repo then have the subagent named "explorer" (spawn it with the safe_subagents tool, agent="explorer") inspect it',
		);
	});

	it("replaces a mention at the start of the message", () => {
		assert.equal(
			replaceAgentMentions("@explorer find the read tool", [testAgent("explorer")]),
			'the subagent named "explorer" (spawn it with the safe_subagents tool, agent="explorer") find the read tool',
		);
	});

	it("adds agentScope to a project agent mention", () => {
		assert.equal(
			replaceAgentMentions("ask @explorer", [testAgent("explorer", "project")]),
			'ask the subagent named "explorer" (spawn it with the safe_subagents tool, agent="explorer", agentScope="both")',
		);
	});

	it("adds agentScope to every mention when one agent is project-level", () => {
		const agents = [testAgent("reviewer"), testAgent("explorer", "project")];

		assert.equal(
			replaceAgentMentions("ask @reviewer then @explorer", agents),
			'ask the subagent named "reviewer" (spawn it with the safe_subagents tool, agent="reviewer", agentScope="both") then the subagent named "explorer" (spawn it with the safe_subagents tool, agent="explorer", agentScope="both")',
		);
	});

	it("leaves unknown mentions and path-like tokens unchanged", () => {
		assert.equal(
			replaceAgentMentions("Read @src/index.ts and ask @unknown", [testAgent("src")]),
			"Read @src/index.ts and ask @unknown",
		);
	});

	it("replaces a repeated mention at each occurrence", () => {
		const agents = [testAgent("explorer")];
		const result = replaceAgentMentions("ask @explorer then @explorer again", agents);

		assert.equal(result.match(/spawn it with the safe_subagents tool/g)?.length, 2);
	});

	it("matches without regard to case and writes the canonical name", () => {
		assert.equal(
			replaceAgentMentions("ask @Explorer", [testAgent("explorer")]),
			'ask the subagent named "explorer" (spawn it with the safe_subagents tool, agent="explorer")',
		);
	});

	it("returns the text unchanged when no agent is known", () => {
		assert.equal(replaceAgentMentions("Review the latest feature", []), "Review the latest feature");
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
				path: "/packages/pi_config/extensions/plan/index.ts",
				source: "git:github.com/leo-kildani/pi_config",
				baseDir: "/packages/pi_config",
			},
		},
	];

	it("maps package/resource selectors to paths from loaded extensions", () => {
		assert.deepEqual(resolveExtensionPaths([
			"@ff-labs/pi-fff",
			"@ff-labs/pi-fff:src",
			"@leo-kildani/pi_config:plan",
		], sources), {
			paths: ["/packages/pi-fff/src/index.ts", "/packages/pi_config/extensions/plan/index.ts"],
			unknown: [],
			ambiguous: [],
		});
	});

	it("lists the available selectors", () => {
		assert.deepEqual(listExtensionNames(sources), [
			"@ff-labs/pi-fff",
			"@ff-labs/pi-fff:src",
			"@leo-kildani/pi_config",
			"@leo-kildani/pi_config:plan",
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
