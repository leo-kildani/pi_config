/**
 * Chain analysis for a bash command.
 *
 * splitCommandChain breaks a command on the unquoted separators ;, &&, ||, |,
 * and newline. evaluateCommandChain runs the deterministic guard on each
 * segment and returns one verdict per command with its source offsets.
 */

import type { GuardMode } from "./config.ts";
import { classifyCommand } from "./classify.ts";
import { evaluateScope } from "./scope.ts";

export interface CommandSpan {
	text: string;
	start: number;
	end: number;
}

export interface CommandVerdict {
	text: string;
	start: number;
	end: number;
	safe: boolean;
	provenReadOnly: boolean;
	reason?: string;
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

function verdict(span: CommandSpan, safe: boolean, provenReadOnly: boolean, reason?: string): CommandVerdict {
	return { ...span, safe, provenReadOnly, reason };
}

function evaluateSegment(span: CommandSpan, cwd: string, scopePath: string | undefined, mode: GuardMode): CommandVerdict {
	if (mode === "off") return verdict(span, true, true);

	const classification = classifyCommand(span.text, cwd);
	if (classification.readsSecrets) {
		return verdict(span, false, false, classification.secretReason ?? "command reads a secret");
	}

	const scope = evaluateScope(span.text, cwd, scopePath);
	if (scope.action === "review") return verdict(span, false, false, scope.reason);

	if (classification.readOnly) return verdict(span, true, true);

	if (classification.writesData || classification.destroysData) {
		return verdict(span, false, false, classification.effectReason ?? "write or destructive command");
	}

	if (mode === "read-only") return verdict(span, false, false, "command is not proven read-only");
	return verdict(span, true, false);
}

export function evaluateCommandChain(
	command: string,
	cwd: string,
	scopePath: string | undefined,
	mode: GuardMode,
): CommandVerdict[] {
	return splitCommandChain(command).map((span) => evaluateSegment(span, cwd, scopePath, mode));
}
