/**
 * Chain analysis for a bash command.
 *
 * splitCommandChain breaks a command on the unquoted separators ;, &&, ||, |,
 * and newline. It keeps command substitutions and backtick groups together.
 * classifyCommandChain classifies each segment and adds its scope result.
 * Every span keeps its source offsets.
 */

import { classifyCommand, detectSensitiveEffect, type CommandClassification } from "./classify.ts";
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
	let quote: "'" | '"' | "`" | null = null;
	let parenDepth = 0;

	while (i < command.length) {
		const char = command[i]!;

		if (quote) {
			if (char === "\\" && (quote === '"' || quote === "`")) {
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
		if (char === "'" || char === '"' || char === "`") {
			quote = char;
			i += 1;
			continue;
		}
		if (char === "(") {
			parenDepth += 1;
			i += 1;
			continue;
		}
		if (char === ")") {
			if (parenDepth > 0) parenDepth -= 1;
			i += 1;
			continue;
		}
		if (parenDepth > 0) {
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
	const spans = splitCommandChain(command);
	const chainEffect = detectSensitiveEffect(command);
	const effectSpan = chainEffect
		? spans.find((span) => chainEffect.index >= span.start && chainEffect.index < span.end) ?? spans[0]
		: undefined;
	return spans.map((span) => {
		const classification = classifyCommand(span.text, cwd);
		if (chainEffect && span === effectSpan) {
			classification.readOnly = false;
			classification.writesData = classification.writesData || chainEffect.writesData;
			classification.destroysData = classification.destroysData || chainEffect.destroysData;
			classification.effectReason = classification.effectReason ?? chainEffect.reason;
		}
		const scope = evaluateScope(span.text, cwd, scopePath);
		return {
			...span,
			classification,
			...(scope.action === "review" ? { scopeReason: scope.reason } : {}),
		};
	});
}
