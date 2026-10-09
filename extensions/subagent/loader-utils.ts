/**
 * loader-utils.ts - Shared helpers for the name-to-path loaders.
 *
 * `skillloader.ts` and `extensionloader.ts` both resolve a list of declared
 * names to absolute paths for pi flags (`--skill`, `-e`). They share the same
 * resolution loop and the same security guards, so those live here once and
 * both loaders import them.
 */

import { statSync } from "node:fs";

/** True if `path` is a symlink. Missing paths are not symlinks. */
export function isSymlink(p: string): boolean {
	try {
		return statSync(p).isSymbolicLink();
	} catch {
		return false;
	}
}

/** Reject names that could escape a load root via path traversal. */
export function isUnsafeName(name: string): boolean {
	return (
		name.includes("/") ||
		name.includes("\\") ||
		name === "." ||
		name === ".." ||
		name.includes("\0")
	);
}

/**
 * Resolve a list of names to loadable paths via `loadOne`, preserving order and
 * deduping. A name that resolves to nothing is skipped, never a failure.
 */
export function resolveDeclaredLoadPaths(
	names: string[],
	cwd: string,
	loadOne: (name: string, cwd: string) => string | undefined
): string[] {
	const seen = new Set<string>();
	const resolved: string[] = [];
	for (const raw of names) {
		const name = raw.trim();
		if (!name || seen.has(name)) continue;
		seen.add(name);
		const path = loadOne(name, cwd);
		if (path) resolved.push(path);
	}
	return resolved;
}
