/**
 * Editor-slot selector for the max-bash-guard extension.
 *
 * renderHighlightedCommand keeps the full command and marks the destructive
 * spans in bold and the error color. decisionForKey maps a keypress to an allow
 * or deny choice. promptForDecision shows the selector in the editor slot above
 * the conversation and resolves true on allow and false on deny.
 */

import { DynamicBorder, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Container, Key, matchesKey, SelectList, Spacer, Text, type SelectItem, type SelectListTheme } from "@earendil-works/pi-tui";

import type { CommandSpan } from "./analyze.ts";

export interface HighlightTheme {
	bold(text: string): string;
	fg(color: string, text: string): string;
}

export function renderHighlightedCommand(command: string, spans: readonly CommandSpan[], theme: HighlightTheme): string {
	if (spans.length === 0) return command;

	const sorted = [...spans].sort((a, b) => a.start - b.start);
	let result = "";
	let cursor = 0;
	for (const span of sorted) {
		if (span.start < cursor || span.end > command.length) continue;
		result += command.slice(cursor, span.start);
		result += theme.fg("error", theme.bold(command.slice(span.start, span.end)));
		cursor = span.end;
	}
	result += command.slice(cursor);
	return result;
}

/**
 * Map one keypress to an allow or deny choice.
 * Return true on y, false on n, and undefined for every other key.
 */
export function decisionForKey(data: string): boolean | undefined {
	if (data === "y" || data === "Y") return true;
	if (data === "n" || data === "N") return false;
	return undefined;
}

export interface DecisionPrompt {
	title: string;
	command: string;
	spans: readonly CommandSpan[];
	reason: string;
}

export async function promptForDecision(ctx: ExtensionContext, prompt: DecisionPrompt): Promise<boolean> {
	const result = await ctx.ui.custom<boolean>((_tui, theme, _kb, done) => {
		const border = () => new DynamicBorder((line: string) => theme.fg("borderAccent", line));
		const container = new Container();
		container.addChild(border());
		container.addChild(new Spacer(1));
		container.addChild(new Text("  " + theme.fg("accent", theme.bold(prompt.title)), 1, 0));
		container.addChild(new Spacer(1));
		container.addChild(new Text("  " + theme.fg("muted", "$ ") + renderHighlightedCommand(prompt.command, prompt.spans, theme), 1, 0));
		container.addChild(new Spacer(1));
		container.addChild(new Text("  " + theme.fg("warning", prompt.reason), 1, 0));
		container.addChild(new Spacer(1));

		const listTheme: SelectListTheme = {
			selectedPrefix: (text) => theme.fg("accent", text),
			selectedText: (text) => theme.fg("accent", text),
			description: (text) => theme.fg("muted", text),
			scrollInfo: (text) => theme.fg("dim", text),
			noMatch: (text) => theme.fg("warning", text),
		};
		const items: SelectItem[] = [
			{ value: "allow", label: "Allow" },
			{ value: "deny", label: "Deny" },
		];
		const list = new SelectList(items, items.length, listTheme);
		container.addChild(list);
		container.addChild(new Spacer(1));
		container.addChild(new Text(
			"  " +
				theme.fg("dim", "↑↓") +
				theme.fg("muted", " select  ") +
				theme.fg("dim", "enter") +
				theme.fg("muted", " confirm  ") +
				theme.fg("dim", "y") +
				theme.fg("muted", " allow  ") +
				theme.fg("dim", "n/esc") +
				theme.fg("muted", " deny"),
			1,
			0,
		));
		container.addChild(new Spacer(1));
		container.addChild(border());

		let resolved = false;
		const finish = (allowed: boolean) => {
			if (resolved) return;
			resolved = true;
			done(allowed);
		};
		list.onSelect = (item) => finish(item.value === "allow");
		list.onCancel = () => finish(false);

		return {
			render: (width: number) => container.render(width),
			invalidate: () => container.invalidate(),
			handleInput: (data: string) => {
				const decision = decisionForKey(data);
				if (decision !== undefined) {
					finish(decision);
					return;
				}
				if (matchesKey(data, Key.escape)) {
					finish(false);
					return;
				}
				list.handleInput(data);
			},
		};
	});

	return result ?? false;
}
