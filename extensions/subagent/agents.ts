/**
 * Agent discovery and configuration
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { CONFIG_DIR_NAME, getAgentDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";

export type AgentScope = "user" | "project" | "both";

/**
 * Thinking levels an agent may declare in its frontmatter. A subset of the full
 * `ThinkingLevel` set: agents only opt into `off`, `low`, `medium`, `high`, or
 * `max`.
 */
export type AgentThinkingLevel = "off" | "low" | "medium" | "high" | "max";

export interface AgentConfig {
	name: string;
	description: string;
	/**
	 * Tri-state list fields. `undefined` means the key is absent (load pi's
	 * default / everything). `[]` means the key is present but empty (load
	 * nothing of that type). A non-empty array lists the exact items to load.
	 * `tools`, `skills`, and `extensions` are tri-state. `packages` is add-only:
	 * only a non-empty array has an effect (each value is a whole-package source).
	 */
	tools?: string[];
	skills?: string[];
	extensions?: string[];
	packages?: string[];
	disableContext?: boolean;
	/** Run the child in RPC mode and relay its UI dialogs to the parent session. */
	interactive?: boolean;
	model?: string;
	thinking?: AgentThinkingLevel;
	systemPrompt: string;
	source: "user" | "project";
	filePath: string;
}

export interface AgentDiscoveryResult {
	agents: AgentConfig[];
	projectAgentsDir: string | null;
}

/**
 * Raw agent frontmatter. Values are `unknown` because `parseFrontmatter` runs a
 * real YAML parser, so any scalar or collection can appear here.
 *
 * A type alias rather than an interface: `parseFrontmatter` constrains its
 * parameter to `Record<string, unknown>`, and only an alias picks up the
 * implicit index signature that satisfies it.
 */
type AgentFrontmatter = {
	name?: unknown;
	description?: unknown;
	tools?: unknown;
	skills?: unknown;
	extensions?: unknown;
	packages?: unknown;
	"disable-context"?: unknown;
	interactive?: unknown;
	model?: unknown;
	thinking?: unknown;
};

/**
 * Normalize a frontmatter list field (for `tools`, `skills`, `extensions`, or
 * `packages`) into a tri-state value. Return `undefined` when the key is absent
 * (load pi default), `[]` when it is present but empty (load nothing), or the
 * trimmed items otherwise. Both YAML spellings are accepted:
 * `skills: a, b` and `skills: [a, b]`. A present-but-unparseable value (a
 * number, map, or nested list) degrades to `[]` so one bad file cannot take down
 * agent discovery.
 */
function parseFieldList(frontmatter: AgentFrontmatter, key: string): string[] | undefined {
	if (!(key in frontmatter)) return undefined;
	const value = frontmatter[key as keyof AgentFrontmatter];
	const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
	return raw
		.filter((t): t is string => typeof t === "string")
		.map((t) => t.trim())
		.filter(Boolean);
}

/**
 * Normalize a boolean frontmatter flag (`disable-context` or `interactive`).
 *
 * Returns true only for a present, truthy value. Missing, empty, false, or
 * unrecognized values all mean false, so one bad file cannot take down agent
 * discovery. Both YAML booleans and their common string spellings are accepted
 * so `true` and `"true"` behave the same.
 */
function parseBooleanFlag(value: unknown): boolean {
	if (value === undefined || value === null) return false;
	if (typeof value === "boolean") return value;
	if (typeof value === "number") return value !== 0;
	if (typeof value === "string") {
		const normalized = value.trim().toLowerCase();
		if (
			normalized === "true" ||
			normalized === "yes" ||
			normalized === "1" ||
			normalized === "on"
		) {
			return true;
		}
	}
	return false;
}

const AGENT_THINKING_LEVELS: readonly AgentThinkingLevel[] = ["off", "low", "medium", "high", "max"];

/**
 * Normalize the `thinking` frontmatter value.
 *
 * Only `off`, `low`, `medium`, `high`, or `max` are accepted
 * (case-insensitive). Any other value yields `undefined` rather than throwing:
 * a bad value must not take down agent discovery, and the caller falls back to
 * the default (`low`).
 */
function parseThinking(value: unknown): AgentThinkingLevel | undefined {
	if (typeof value !== "string") return undefined;
	const normalized = value.trim().toLowerCase();
	return AGENT_THINKING_LEVELS.includes(normalized as AgentThinkingLevel)
		? (normalized as AgentThinkingLevel)
		: undefined;
}

function loadAgentsFromDir(dir: string, source: "user" | "project"): AgentConfig[] {
	const agents: AgentConfig[] = [];

	if (!fs.existsSync(dir)) {
		return agents;
	}

	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return agents;
	}

	for (const entry of entries) {
		if (!entry.name.endsWith(".md")) continue;
		if (!entry.isFile() && !entry.isSymbolicLink()) continue;

		const filePath = path.join(dir, entry.name);
		let content: string;
		try {
			content = fs.readFileSync(filePath, "utf-8");
		} catch {
			continue;
		}

		const { frontmatter, body } = parseFrontmatter<AgentFrontmatter>(content);

		if (typeof frontmatter.name !== "string" || typeof frontmatter.description !== "string") {
			continue;
		}

		agents.push({
			name: frontmatter.name,
			description: frontmatter.description,
			tools: parseFieldList(frontmatter, "tools"),
			skills: parseFieldList(frontmatter, "skills"),
			extensions: parseFieldList(frontmatter, "extensions"),
			packages: parseFieldList(frontmatter, "packages"),
			disableContext: parseBooleanFlag(frontmatter["disable-context"]),
			interactive: parseBooleanFlag(frontmatter.interactive),
			model: typeof frontmatter.model === "string" ? frontmatter.model : undefined,
			thinking: parseThinking(frontmatter.thinking),
			systemPrompt: body,
			source,
			filePath,
		});
	}

	return agents;
}

function isDirectory(p: string): boolean {
	try {
		return fs.statSync(p).isDirectory();
	} catch {
		return false;
	}
}

function findNearestProjectAgentsDir(cwd: string): string | null {
	let currentDir = cwd;
	while (true) {
		const candidate = path.join(currentDir, CONFIG_DIR_NAME, "agents");
		if (isDirectory(candidate)) return candidate;

		const parentDir = path.dirname(currentDir);
		if (parentDir === currentDir) return null;
		currentDir = parentDir;
	}
}

export function discoverAgents(cwd: string, scope: AgentScope): AgentDiscoveryResult {
	const userDir = path.join(getAgentDir(), "agents");
	const projectAgentsDir = findNearestProjectAgentsDir(cwd);

	const userAgents = scope === "project" ? [] : loadAgentsFromDir(userDir, "user");
	const projectAgents = scope === "user" || !projectAgentsDir ? [] : loadAgentsFromDir(projectAgentsDir, "project");

	const agentMap = new Map<string, AgentConfig>();

	if (scope === "both") {
		for (const agent of userAgents) agentMap.set(agent.name, agent);
		for (const agent of projectAgents) agentMap.set(agent.name, agent);
	} else if (scope === "user") {
		for (const agent of userAgents) agentMap.set(agent.name, agent);
	} else {
		for (const agent of projectAgents) agentMap.set(agent.name, agent);
	}

	return { agents: Array.from(agentMap.values()), projectAgentsDir };
}
