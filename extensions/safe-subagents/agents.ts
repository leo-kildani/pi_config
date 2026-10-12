/**
 * Agent discovery and configuration
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { CONFIG_DIR_NAME, getAgentDir, parseFrontmatter, type SlashCommandInfo } from "@earendil-works/pi-coding-agent";

export type AgentScope = "user" | "project" | "both";

export interface AgentConfig {
	name: string;
	description: string;
	tools?: string[];
	/** Extensions this agent may load. Empty means it loads none. */
	extensions: string[];
	/** Skills this agent may load. Empty means it loads none. */
	skills: string[];
	model?: string;
	systemPrompt: string;
	source: "user" | "project";
	filePath: string;
}

export interface AgentDiscoveryResult {
	agents: AgentConfig[];
	projectAgentsDir: string | null;
}

export interface ExtensionSource {
	sourceInfo: { path: string; source: string; baseDir?: string };
}

export interface ExtensionPathResolution {
	paths: string[];
	unknown: string[];
	ambiguous: Array<{ name: string; paths: string[] }>;
}

export function buildExtensionArgs(extensions: string[]): string[] {
	return ["--no-extensions", ...extensions.flatMap((extension) => ["--extension", extension])];
}

function packageName(source: string): string {
	let name = source.replace(/^(npm:|git:)/, "");
	if (name.startsWith("github.com/")) name = `@${name.slice("github.com/".length)}`;
	name = name.replace(/\.git$/, "");
	const versionAt = name.lastIndexOf("@");
	if (versionAt > name.lastIndexOf("/")) name = name.slice(0, versionAt);
	return name === "local" || name.startsWith("<") ? "" : name;
}

function resourceName(sourceInfo: ExtensionSource["sourceInfo"]): string {
	const relativePath = sourceInfo.baseDir ? path.relative(sourceInfo.baseDir, sourceInfo.path) : path.basename(sourceInfo.path);
	const safePath = relativePath === ".." || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)
		? path.basename(sourceInfo.path)
		: relativePath;
	return safePath
		.split(path.sep).join("/")
		.replace(/^extensions\//, "")
		.replace(/\/index\.(?:[cm]?[jt]sx?)$/i, "")
		.replace(/\.(?:[cm]?[jt]sx?)$/i, "")
		.replace(/\/$/, "")
		.replace(/^\.$/, "");
}

function extensionSelectors(sourceInfo: ExtensionSource["sourceInfo"]): string[] {
	if (sourceInfo.path.startsWith("builtin:") || sourceInfo.path.startsWith("<")) return [];
	const packageId = packageName(sourceInfo.source);
	const resource = resourceName(sourceInfo);
	const selectors = new Set<string>();
	if (packageId) {
		selectors.add(packageId);
		if (resource) selectors.add(`${packageId}:${resource}`);
	} else if (resource) {
		selectors.add(resource);
	}
	return [...selectors];
}

function extensionPathsBySelector(sources: ExtensionSource[]): Map<string, Set<string>> {
	const bySelector = new Map<string, Set<string>>();
	for (const { sourceInfo } of sources) {
		for (const selector of extensionSelectors(sourceInfo)) {
			const paths = bySelector.get(selector) ?? new Set<string>();
			paths.add(sourceInfo.path);
			bySelector.set(selector, paths);
		}
	}
	return bySelector;
}

function isExplicitExtensionPath(value: string): boolean {
	return (
		path.isAbsolute(value) ||
		value.startsWith("./") ||
		value.startsWith("../") ||
		value.startsWith("~/") ||
		value.startsWith("builtin:") ||
		value.startsWith("npm:") ||
		value.startsWith("git:") ||
		value.startsWith("github:") ||
		value.startsWith("file:") ||
		path.extname(value) !== ""
	);
}

export function listExtensionNames(sources: ExtensionSource[]): string[] {
	return [...extensionPathsBySelector(sources).keys()].sort();
}

export function resolveExtensionPaths(names: string[], sources: ExtensionSource[]): ExtensionPathResolution {
	const bySelector = extensionPathsBySelector(sources);
	const paths: string[] = [];
	const unknown: string[] = [];
	const ambiguous: ExtensionPathResolution["ambiguous"] = [];

	for (const name of names) {
		if (isExplicitExtensionPath(name)) {
			paths.push(name);
			continue;
		}
		const matches = [...(bySelector.get(name) ?? [])];
		if (matches.length === 0) unknown.push(name);
		else if (matches.length > 1) ambiguous.push({ name, paths: matches });
		else paths.push(matches[0]);
	}

	return { paths: [...new Set(paths)], unknown, ambiguous };
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
	extensions?: unknown;
	skills?: unknown;
	model?: unknown;
};

/**
 * Normalize a frontmatter `tools`, `skills`, or `extensions` value to a list of names.
 *
 * Both spellings are valid YAML and both are in use:
 *
 *     skills: ponytail, writing-in-ste   # string
 *     skills: [ponytail]                 # array
 *
 * so accept either. Anything else (a number, a map, a nested list) yields no
 * names rather than throwing: this runs inside agent discovery, where a single
 * bad file must not take down every other agent in the same directory.
 */
function parseNameList(value: unknown): string[] {
	const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
	return raw
		.filter((t): t is string => typeof t === "string")
		.map((t) => t.trim())
		.filter(Boolean);
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

		const tools = parseNameList(frontmatter.tools);

		agents.push({
			name: frontmatter.name,
			description: frontmatter.description,
			tools: tools.length > 0 ? tools : undefined,
			extensions: parseNameList(frontmatter.extensions),
			skills: parseNameList(frontmatter.skills),
			model: typeof frontmatter.model === "string" ? frontmatter.model : undefined,
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

export function formatAgentList(agents: AgentConfig[], maxItems: number): { text: string; remaining: number } {
	if (agents.length === 0) return { text: "none", remaining: 0 };
	const listed = agents.slice(0, maxItems);
	const remaining = agents.length - listed.length;
	return {
		text: listed.map((a) => `${a.name} (${a.source}): ${a.description}`).join("; "),
		remaining,
	};
}

/**
 * Map skill names to loadable paths, using the slash commands of the parent
 * session. Each skill command carries the SKILL.md path of a skill the parent
 * can see, installed packages included.
 */
function skillPathsByName(commands: SlashCommandInfo[]): Map<string, string> {
	const byName = new Map<string, string>();
	for (const command of commands) {
		if (command.source === "skill") byName.set(command.name.replace(/^skill:/, ""), command.sourceInfo.path);
	}
	return byName;
}

/** Names of every skill the parent session can load, sorted. */
export function listSkillNames(commands: SlashCommandInfo[]): string[] {
	return [...skillPathsByName(commands).keys()].sort();
}

/**
 * Resolve declared skill names to paths for the child's `--skill` flag. A name
 * the parent cannot resolve comes back in `unknown`, for the caller to report.
 */
export function resolveSkillPaths(
	names: string[],
	commands: SlashCommandInfo[],
): { paths: string[]; unknown: string[] } {
	const byName = skillPathsByName(commands);
	const paths: string[] = [];
	const unknown: string[] = [];
	for (const name of names) {
		const path = byName.get(name);
		if (path) paths.push(path);
		else unknown.push(name);
	}
	return { paths, unknown };
}
