/**
 * Mention Autocomplete - "@agent" completion in the TUI editor
 *
 * Typing "@" at a line start or after whitespace offers every available agent
 * handle with its description. Deliberately decoupled from the mention
 * transform in mentions.ts: this module keeps its own copy of the slug and
 * trigger rules so the two features share no state and cannot drift each
 * other through refactors. The handles offered here are exactly the handles
 * the transform expands on send (slug collisions resolve last-read-wins in
 * both, so the shown description names the agent that will expand).
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem } from "@earendil-works/pi-tui";
import { discoverAgents } from "./agents.ts";

/**
 * Slug an agent name into a mention handle. Mirrors mentions.ts handleOf on
 * purpose (no shared helper): what completes must equal what expands.
 */
function handleOf(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^\w-]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

/**
 * The "@handle" token being typed before the cursor, or null when the cursor
 * is not inside an agent mention. The trigger mirrors the expander's left
 * boundary: "@" at start or after whitespace.
 */
function mentionPrefixBeforeCursor(line: string, cursorCol: number): string | null {
	const match = line.slice(0, cursorCol).match(/(?:^|\s)@([\w-]*)$/);
	return match ? match[1] : null;
}

export function registerMentionAutocomplete(pi: ExtensionAPI): void {
	pi.on("session_start", (_event, ctx) => {
		ctx.ui.addAutocompleteProvider((current) => ({
			triggerCharacters: ["@"],

			async getSuggestions(lines, cursorLine, cursorCol, options) {
				const line = lines[cursorLine] ?? "";
				const typed = mentionPrefixBeforeCursor(line, cursorCol);
				if (typed === null) {
					return current.getSuggestions(lines, cursorLine, cursorCol, options);
				}

				const query = typed.toLowerCase();
				const byHandle = new Map<string, string>();
				for (const a of discoverAgents(ctx.cwd, "user").agents) {
					const handle = handleOf(a.name);
					// Slug collisions (e.g. "My Agent" vs "my-agent"): last one read
					// wins, mirroring mentions.ts so the description matches the
					// agent the transform would expand.
					if (handle) byHandle.set(handle, a.description);
				}
				const items: AutocompleteItem[] = Array.from(byHandle)
					.filter(([h]) => h.startsWith(query))
					.sort(([a], [b]) => a.localeCompare(b))
					.map(([h, d]) => ({ value: "@" + h, label: "@" + h, description: d }));

				if (items.length === 0) {
					return current.getSuggestions(lines, cursorLine, cursorCol, options);
				}

				return { items, prefix: "@" + typed };
			},

			applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
				return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
			},

			shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
				return current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
			},
		}));
	});
}