/**
 * Directory scope for the max-bash-guard extension.
 *
 * resolveScopePath returns the boundary a command may touch. evaluateScope
 * reviews a command segment when a path argument resolves outside the boundary.
 * The maxguard.env file in the working directory holds the SCOPE value.
 *
 * The scope setting is off, cwd, or custom. off has no boundary. cwd uses the
 * working directory. custom reads SCOPE from maxguard.env and falls back to the
 * working directory when the value is missing or the path is not a directory.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import type { ScopeMode } from "./config.ts";
import { extractPathArgs, isInTmp, isInside, normalizeCommand, resolveCommandPath } from "./classify.ts";

export type ScopeDecision = { action: "none" } | { action: "review"; reason: string };

const SCOPE_FILE = "maxguard.env";
const SCOPE_LINE = /^\s*SCOPE\s*=\s*(.*)$/;

function stripQuotes(value: string): string {
	if (value.length >= 2) {
		const first = value[0];
		const last = value[value.length - 1];
		if ((first === '"' && last === '"') || (first === "'" && last === "'")) return value.slice(1, -1);
	}
	return value;
}

function isDirectory(target: string): boolean {
	try {
		return statSync(target).isDirectory();
	} catch {
		return false;
	}
}

/**
 * Return the SCOPE value from maxguard.env in cwd. Return undefined when the
 * file is absent, unreadable, has no SCOPE line, or has an empty value.
 */
export function readScopePath(cwd: string): string | undefined {
	const file = path.join(cwd, SCOPE_FILE);
	if (!existsSync(file)) return undefined;

	let content: string;
	try {
		content = readFileSync(file, "utf8");
	} catch {
		return undefined;
	}

	for (const line of content.split(/\r?\n/)) {
		const match = SCOPE_LINE.exec(line);
		if (!match) continue;
		const value = stripQuotes((match[1] ?? "").trim());
		return value.length > 0 ? value : undefined;
	}
	return undefined;
}

/**
 * Return the boundary path for the scope setting. off returns undefined. cwd
 * returns cwd. custom resolves SCOPE against cwd and falls back to cwd when the
 * value is missing or the path is not an existing directory.
 */
export function resolveScopePath(scope: ScopeMode, cwd: string): string | undefined {
	if (scope === "off") return undefined;
	if (scope === "cwd") return cwd;

	const raw = readScopePath(cwd);
	if (!raw) return cwd;
	const resolved = path.isAbsolute(raw) ? raw : path.resolve(cwd, raw);
	return isDirectory(resolved) ? resolved : cwd;
}

/**
 * Review one command segment when a path argument resolves outside the scope
 * boundary. A path inside /tmp is not a scope violation. An undefined scopePath
 * means no boundary, so the result is always none.
 */
export function evaluateScope(command: string, cwd: string, scopePath: string | undefined): ScopeDecision {
	if (!scopePath) return { action: "none" };

	const normalized = normalizeCommand(command);
	const resolvedPaths = extractPathArgs(normalized).map((arg) => resolveCommandPath(arg, cwd));
	for (const filePath of resolvedPaths) {
		if (!isInside(scopePath, filePath) && !isInTmp(filePath)) {
			return { action: "review", reason: `path outside scope: ${filePath}` };
		}
	}
	return { action: "none" };
}
