/**
 * skillloader.ts - Resolve declared skill names to their loadable paths.
 *
 * Pi loads explicit skills with `--skill <path>` (a skill directory or a
 * markdown file) and disables auto-discovery with `--no-skills`. The frontmatter
 * `skills:` field holds names, so this module turns each name into the absolute
 * path pi needs. It does not preload skill content; pi loads and formats each
 * skill itself.
 *
 * Roots, in precedence order:
 *   - <cwd>/.pi/skills           (project, Pi's standard)
 *   - <cwd>/.agents/skills       (project, cross-tool Agent Skills spec - https://agentskills.io)
 *   - getAgentDir()/skills       (user, default ~/.pi/agent/skills - Pi's standard)
 *   - ~/.agents/skills           (user, cross-tool Agent Skills spec)
 *   - ~/.pi/skills               (legacy global, pre-Pi)
 *
 * Layout per root:
 *   - <root>/<name>.md            (flat file at the top level)
 *   - <root>/.../<name>/SKILL.md  (directory skill, may be nested - Pi's standard)
 *
 * Recursion skips dotfile entries and node_modules. A directory that itself
 * contains SKILL.md is a skill - we do not descend into it (Pi: skills don't nest).
 *
 * Shared guards live in loader-utils.ts: symlinks and path-traversal names are
 * rejected, and a name that resolves to nothing is skipped, never a failure.
 */

import type { Dirent } from "node:fs";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { isSymlink, isUnsafeName, resolveDeclaredLoadPaths } from "./loader-utils.ts";

/** Resolve a list of skill names to their loadable paths, preserving order and deduping. */
export function resolveSkillLoadPaths(skillNames: string[], cwd: string): string[] {
	return resolveDeclaredLoadPaths(skillNames, cwd, loadSkillPath);
}

/**
 * Resolve one skill name to a loadable path, or undefined when not found.
 * The first root that holds the skill wins.
 */
function loadSkillPath(name: string, cwd: string): string | undefined {
	if (isUnsafeName(name)) return undefined;
	const roots = [
		join(cwd, ".pi", "skills"), // project - Pi standard
		join(cwd, ".agents", "skills"), // project - Agent Skills spec
		join(getAgentDir(), "skills"), // user - Pi standard
		join(homedir(), ".agents", "skills"), // user - Agent Skills spec
		join(homedir(), ".pi", "skills"), // legacy global, pre-Pi
	];
	for (const root of roots) {
		const found = findInRoot(root, name);
		if (found !== undefined) return found;
	}
	return undefined;
}

function findInRoot(root: string, name: string): string | undefined {
	if (isSymlink(root)) return undefined; // reject symlinked roots entirely
	const flatPath = join(root, `${name}.md`);
	if (existsSync(flatPath) && !isSymlink(flatPath)) return flatPath; // flat skill file
	return findSkillDirectory(root, name);
}

/**
 * BFS under `root` for a directory named `name` containing SKILL.md.
 * Returns the skill directory path (pi loads SKILL.md from within it).
 */
function findSkillDirectory(root: string, name: string): string | undefined {
	if (!existsSync(root)) return undefined;
	const queue: string[] = [root];

	while (queue.length > 0) {
		const current = queue.shift();
		if (current === undefined) continue;

		let entries: Dirent<string>[];
		try {
			entries = readdirSync(current, { withFileTypes: true });
		} catch {
			continue;
		}

		// Deterministic byte-order traversal - locale-independent.
		entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			if (entry.name.startsWith(".") || entry.name === "node_modules") continue;

			// Symlinked dirs already filtered by entry.isDirectory() - Dirent uses lstat semantics.
			const childPath = join(current, entry.name);
			const skillMd = join(childPath, "SKILL.md");
			const isSkillDir = existsSync(skillMd);

			if (isSkillDir) {
				if (entry.name === name) return childPath; // Pi rule: skills don't nest
				continue;
			}

			queue.push(childPath);
		}
	}
	return undefined;
}
