/**
 * Agent Mention Transform - "@agent" tag expansion
 *
 * Expands plain "@name" tags in user input into explicit subagent spawn
 * directives, so the main agent naturally calls the subagent tool. Unknown
 * tags, emails, and any text without a match pass through untouched. Agent
 * names are discovered fresh per input event, so new agent files apply
 * immediately.
 *
 * Matching mirrors the tintinweb/pi-subagents mention grammar where it fits
 * this prose-expansion architecture: handles are case-insensitive slugs of
 * the agent name.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { discoverAgents } from "./agents.ts";

/** The directive inserted in place of a matched tag. */
function spawnDirective(name: string): string {
	return `the subagent named "${name}" (spawn it with the subagent tool, agent="${name}")`;
}

/**
 * Slug an agent name into a mention handle, mirroring the repo's handleBase:
 * lowercase, non-word runs become "-", leading and trailing "-" trimmed. The
 * result only contains [\w-], so a pattern built from handles needs no regex
 * escaping. Names whose slug is empty (for example pure non-ASCII) get no
 * handle and cannot be mentioned.
 */
function handleOf(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^\w-]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

/**
 * Per-event mention lookup. Returns a Map<handle, realName> and the RegExp
 * that matches "@handle", or null when no agent has a usable handle.
 */
function mentionMatch(cwd: string): { byHandle: Map<string, string>; re: RegExp } | null {
	const byHandle = new Map<string, string>();
	for (const agent of discoverAgents(cwd, "user").agents) {
		const handle = handleOf(agent.name);
		// Slug collision (e.g. "My Agent" vs "my-agent"): last one read wins.
		if (handle) byHandle.set(handle, agent.name);
	}
	if (byHandle.size === 0) return null;
	// Longest-first so a handle that prefixes another never shadows it.
	const handles = Array.from(byHandle.keys()).sort((a, b) => b.length - a.length);
	// Left boundary: "@" at start or after whitespace, so emails such as
	// "user@reviewer" are never rewritten. Right boundary: not followed by a
	// word char or "-", matching the autocomplete handle alphabet, so
	// "@reviewers" does not match "@reviewer" and "@reviewer-foo" does not
	// partially expand.
	const re = new RegExp(`(?<!\\S)@(${handles.join("|")})(?![\\w-])`, "gi");
	return { byHandle, re };
}

export function registerMentionTransform(pi: ExtensionAPI): void {
	pi.on("input", (event, ctx) => {
		// Only human-typed prompts expand mentions; extension-injected
		// messages (follow-ups from tools) pass through untouched.
		if (event.source === "extension") return { action: "continue" };
		if (!event.text.includes("@")) return { action: "continue" };
		const match = mentionMatch(ctx.cwd);
		if (match === null) return { action: "continue" };
		const { byHandle, re } = match;
		// Handles are lowercase slugs, so a "gi"-flagged capture needs only a
		// toLowerCase() to hit the map; the lookup is total for any match.
		const replaced = event.text.replace(re, (_whole, handle: string) =>
			spawnDirective(byHandle.get(handle.toLowerCase())!),
		);
		if (replaced === event.text) return { action: "continue" };
		return { action: "transform", text: replaced };
	});
}