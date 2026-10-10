/**
 * Chain analysis for a bash command.
 *
 * splitCommandChain breaks a command on the unquoted separators ;, &&, ||, |,
 * and newline. analyzeCommand runs the deterministic policy on each segment and
 * reports the destructive segments with their source offsets.
 */

import { evaluateCommandPolicy, type PolicyOptions } from "./policy.ts";

export interface CommandSpan {
	text: string;
	start: number;
	end: number;
}

export interface CommandAnalysis {
	destructive: boolean;
	spans: CommandSpan[];
	reasons: string[];
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

function wholeCommandSpan(command: string): CommandSpan | null {
	const spans: CommandSpan[] = [];
	pushTrimmed(command, spans, 0, command.length);
	return spans[0] ?? null;
}

export function analyzeCommand(command: string, cwd: string, options: PolicyOptions = {}): CommandAnalysis {
	const spans: CommandSpan[] = [];
	const reasons: string[] = [];

	for (const segment of splitCommandChain(command)) {
		const decision = evaluateCommandPolicy(segment.text, cwd, options);
		if (decision.action === "review") {
			spans.push(segment);
			reasons.push(decision.reason);
		}
	}

	if (spans.length === 0) {
		const decision = evaluateCommandPolicy(command, cwd, options);
		if (decision.action === "review") {
			const whole = wholeCommandSpan(command);
			if (whole) spans.push(whole);
			reasons.push(decision.reason);
		}
	}

	return { destructive: spans.length > 0, spans, reasons };
}
