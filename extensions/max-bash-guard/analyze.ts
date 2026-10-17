/**
 * Chain analysis for a bash command.
 *
 * splitCommandChain breaks a command on the unquoted separators ;, &&, ||, |,
 * and newline. classifyCommandChain classifies each segment and adds its scope
 * result. Every span keeps its source offsets.
 */

import { classifyCommand, type CommandClassification } from "./classify.ts";
import { evaluateScope } from "./scope.ts";

export interface CommandSpan {
	text: string;
	start: number;
	end: number;
}

export interface ClassifiedSpan extends CommandSpan {
	classification: CommandClassification;
	scopeReason?: string;
}

function pushTrimmed(command: string, spans: CommandSpan[], from: number, to: number): void {
	const raw = command.slice(from, to);
	const leading = raw.length - raw.trimStart().length;
	const trailing = raw.length - raw.trimEnd().length;
	const start = from + leading;
	const end = to - trailing;
	if (end > start) spans.push({ text: command.slice(start, end), start, end });
}

export function splitCommandChain(command: string): CommandSpan[] {
	const spans: CommandSpan[] = [];
	let start = 0;
	let i = 0;
	let quote: "'" | '"' | null = null;

	while (i < command.length) {
		const char = command[i]!;

		if (quote) {
			if (char === "\\" && quote === '"') {
				i += 2;
				continue;
			}
			if (char === quote) quote = null;
			i += 1;
			continue;
		}

		if (char === "\\") {
			i += 2;
			continue;
		}
		if (char === "'" || char === '"') {
			quote = char;
			i += 1;
			continue;
		}
		if (char === "\n" || char === ";") {
			pushTrimmed(command, spans, start, i);
			i += 1;
			start = i;
			continue;
		}
		if (char === "&" && command[i + 1] === "&") {
			pushTrimmed(command, spans, start, i);
			i += 2;
			start = i;
			continue;
		}
		if (char === "|") {
			pushTrimmed(command, spans, start, i);
			i += command[i + 1] === "|" ? 2 : 1;
			start = i;
			continue;
		}

		i += 1;
	}

	pushTrimmed(command, spans, start, command.length);
	return spans;
}

export function classifyCommandChain(
	command: string,
	cwd: string,
	scopePath: string | undefined,
): ClassifiedSpan[] {
	return splitCommandChain(command).map((span) => {
		const classification = classifyCommand(span.text, cwd);
		const scope = evaluateScope(span.text, cwd, scopePath);
		return {
			...span,
			classification,
			...(scope.action === "review" ? { scopeReason: scope.reason } : {}),
		};
	});
}
