/**
 * extensionloader.ts - Resolve declared extension names to their entry files.
 *
 * Pi loads extensions with `-e <source>` and disables auto-discovery with
 * `--no-extensions`. The frontmatter `extensions:` field holds names, so this
 * module turns each name into the absolute entry-file path pi needs. It does
 * not load extension content; pi loads each file itself.
 *
 * Pi auto-discovers extensions from these roots (docs/extensions.md):
 *   - getAgentDir()/extensions/<name>.ts       (global, flat file)
 *   - getAgentDir()/extensions/<name>/index.ts (global, subdirectory)
 *   - <cwd>/.pi/extensions/<name>.ts           (project, flat file)
 *   - <cwd>/.pi/extensions/<name>/index.ts     (project, subdirectory)
 *
 * Resolution checks the project root before the user root, matching how skills
 * are resolved. Layout per root:
 *   - <root>/<name>.ts        (flat extension entry)
 *   - <root>/<name>/index.ts  (multi-file extension directory)
 *
 * Shared guards live in loader-utils.ts: symlinks and path-traversal names are
 * rejected, and a name that resolves to nothing is skipped, never a failure.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { isSymlink, isUnsafeName, resolveDeclaredLoadPaths } from "./loader-utils.ts";

/** Prefix that marks a pi built-in extension (`builtin:mcp`), passed to `-e` verbatim. */
const BUILTIN_PREFIX = "builtin:";

/** Resolve a list of extension names to their entry-file paths, preserving order and deduping. */
export function resolveExtensionLoadPaths(extensionNames: string[], cwd: string): string[] {
	return resolveDeclaredLoadPaths(extensionNames, cwd, loadExtensionPath);
}

/**
 * Resolve one extension name to its entry-file path, or undefined when not
 * found. The first root that holds the extension wins. A `builtin:<name>`
 * entry passes through unchanged; pi re-enables that built-in under
 * `--no-extensions` when it sees `-e builtin:<name>`.
 */
function loadExtensionPath(name: string, cwd: string): string | undefined {
	if (isUnsafeName(name)) return undefined;
	if (name.startsWith(BUILTIN_PREFIX) && name.length > BUILTIN_PREFIX.length) return name;
	const roots = [
		join(cwd, ".pi", "extensions"), // project - Pi standard
		join(getAgentDir(), "extensions"), // user - Pi standard
	];
	for (const root of roots) {
		const found = findInRoot(root, name);
		if (found !== undefined) return found;
	}
	return undefined;
}

function findInRoot(root: string, name: string): string | undefined {
	if (isSymlink(root)) return undefined; // reject symlinked roots entirely
	const flatPath = join(root, `${name}.ts`);
	if (existsSync(flatPath) && !isSymlink(flatPath)) return flatPath; // flat entry
	const dirEntry = join(root, name, "index.ts");
	if (existsSync(dirEntry) && !isSymlink(dirEntry)) return dirEntry; // subdirectory entry
	return undefined;
}
