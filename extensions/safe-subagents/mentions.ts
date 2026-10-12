import type {
	AutocompleteItem,
	AutocompleteProvider,
	AutocompleteSuggestions,
} from "@earendil-works/pi-tui";
import type { AgentConfig } from "./agents.ts";

const MENTION_TRIGGER = /(^|[\s。、？！])@([\w-]*)$/;

export function createAgentMentionProvider(
	current: AutocompleteProvider,
	getAgents: () => AgentConfig[],
): AutocompleteProvider {
	return {
		triggerCharacters: ["@"],

		async getSuggestions(lines, cursorLine, cursorCol, options): Promise<AutocompleteSuggestions | null> {
			const line = lines[cursorLine] ?? "";
			const match = MENTION_TRIGGER.exec(line.slice(0, cursorCol));
			const mine = match ? agentSuggestions(getAgents(), match[2]) : null;
			const theirs = await current.getSuggestions(lines, cursorLine, cursorCol, options);

			if (!mine) return theirs;
			if (!theirs) return mine;
			if (theirs.prefix !== mine.prefix) return theirs;
			return { items: [...mine.items, ...theirs.items], prefix: mine.prefix };
		},

		applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
			return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
		},

		shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
			return current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
		},
	};
}

function agentSuggestions(agents: AgentConfig[], typed: string): AutocompleteSuggestions | null {
	const prefix = `@${typed}`;
	const lowerTyped = typed.toLowerCase();
	const items: AutocompleteItem[] = agents
		.filter((agent) => agent.name.toLowerCase().startsWith(lowerTyped))
		.map((agent) => ({
			value: `@${agent.name}`,
			label: `@${agent.name}`,
			description: agent.description,
		}));

	return items.length > 0 ? { items, prefix } : null;
}
