/**
 * todowrite extension
 *
 * A single replace-style todo tool for live plan execution tracking.
 *
 * The whole list is the state. Every call REPLACES the list with the entries
 * passed; anything not mentioned is removed. The plan flow loads a fresh set
 * in one call, then re-passes the full list as statuses flip.
 *
 * State lives in tool-result details, so forking and branching keep the todo
 * list correct for each point in history. No files are written.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type, type Static } from "typebox";
import { TODO_STATUSES, type Todo, type TodoStatus, resolveTodos, sanitizeTodos } from "./resolve.ts";

interface TodoDetails {
	todos: Todo[];
}

// Status markers used in the transcript text, the /todos command, and the widget.
const STATUS_CHAR: Record<TodoStatus, string> = {
	pending: " ",
	in_progress: "~",
	completed: "x",
	cancelled: "-",
};

// Widget row colors per status, chosen so the block stands apart from the context above.
const STATUS_COLOR = {
	pending: "muted",
	in_progress: "accent",
	completed: "success",
	cancelled: "dim",
} as const;

const TodoParams = Type.Object({
	todos: Type.Array(
		Type.Object({
			id: Type.String({ description: "Stable todo id. Example: todo-1" }),
			content: Type.Optional(
				Type.String({
					description:
						"Todo text. Required for a new id. For an existing id, omit to keep the current text.",
				}),
			),
			status: Type.Optional(StringEnum(TODO_STATUSES)),
		}),
	),
});

const TodoOutput = Type.Object({
	todos: Type.Array(
		Type.Object({
			id: Type.String(),
			content: Type.String(),
			status: StringEnum(TODO_STATUSES),
		}),
	),
});

function completedCount(list: Todo[]): number {
	return list.filter((t) => t.status === "completed").length;
}

function rowText(t: Todo): string {
	return `[${STATUS_CHAR[t.status]}] ${t.id}: ${t.content}`;
}

function formatList(list: Todo[]): string {
	if (list.length === 0) return "No todos.";
	const completed = completedCount(list);
	return `${completed}/${list.length} complete\n${list.map(rowText).join("\n")}`;
}

export default function (pi: ExtensionAPI): void {
	let todos: Todo[] = [];
	// Whether the todo list widget is currently shown.
	let widgetVisible = false;

	/** Rebuild in-memory state from the session branch. Scans tool results for
	 * this tool and applies the last one found, so the list matches the current
	 * point in history.
	 */
	function reconstructState(ctx: ExtensionContext): void {
		todos = [];
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type !== "message") continue;
			const msg = entry.message;
			if (msg.role !== "toolResult" || msg.toolName !== "write-todos") continue;
			// Session details are external input; validate before trusting them.
			const details = msg.details as TodoDetails | undefined;
			const clean = sanitizeTodos(details?.todos);
			if (clean) {
				todos = clean;
			}
		}
	}

	function updateUI(ctx: ExtensionContext): void {
		const hasWork = todos.some((t) => t.status === "pending" || t.status === "in_progress");
		if (!hasWork) {
			ctx.ui.setStatus("todowrite", undefined);
			return;
		}

		const completed = completedCount(todos);
		ctx.ui.setStatus("todowrite", ctx.ui.theme.fg("accent", `Todos: ${completed}/${todos.length}`));
	}

	/** Widget lines, colored by status so the block stands apart from the context above the editor. */
	function widgetLines(ctx: ExtensionContext): string[] {
		const theme = ctx.ui.theme;
		if (todos.length === 0) return [theme.fg("accent", "No todos.")];
		const completed = completedCount(todos);
		const header = theme.fg("accent", `Todos: ${completed}/${todos.length} complete`);
		const rows = todos.map((t) => theme.fg(STATUS_COLOR[t.status], rowText(t)));
		return [header, ...rows];
	}

	/** Refresh the widget in place; hidden widgets stay hidden. */
	function syncWidget(ctx: ExtensionContext): void {
		if (!widgetVisible) return;
		ctx.ui.setWidget("todowrite", widgetLines(ctx));
	}

	pi.registerTool({
		name: "write-todos",
		label: "write-todos",
		description:
			"Maintain the session's single todo list. Every call REPLACES the whole list " +
			"with the entries you pass; anything you do not mention is removed. " +
			"Pass the full current list on every call, changing status or content as needed. " +
			"Each entry has id, content, and status. Statuses: pending, in_progress, completed, cancelled. " +
			"For an existing id, omit content to keep the current text, or omit status to keep the current status. " +
			"For a new id, content is required and status defaults to pending. " +
			"Every call returns the full current list. " +
			"Rules: keep at most one todo in_progress at a time. " +
			"Mark a todo completed as soon as its step finishes. " +
			"Use the tool for multi-step work, not trivial one-off tasks.",
		parameters: TodoParams,
		outputSchema: TodoOutput,
		annotations: {
			readOnlyHint: false,
			destructiveHint: false,
			idempotentHint: true,
			openWorldHint: false,
		},

		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			// Replace the whole list: resolve each passed entry against the old
			// list (keep omitted content/status for existing ids), then swap.
			const result = resolveTodos(todos, params.todos);
			if (!result.ok) {
				const structured: Static<typeof TodoOutput> = { todos };
				return {
					content: [{ type: "text", text: `Error: ${result.error}` }],
					details: { todos },
					structuredContent: structured,
				};
			}
			todos = result.todos;

			const structured: Static<typeof TodoOutput> = { todos };
			return {
				content: [{ type: "text", text: formatList(todos) }],
				details: { todos },
				structuredContent: structured,
			};
		},
	});

	pi.registerCommand("todos", {
		description: "Toggle the todo list widget (show or hide)",
		handler: async (_args, ctx) => {
			widgetVisible = !widgetVisible;
			ctx.ui.setWidget("todowrite", widgetVisible ? widgetLines(ctx) : undefined);
		},
	});

	// Keep the status live: the execute handler mutated `todos` in place, so
	// re-render from memory after each write-todos call.
	pi.on("tool_execution_end", async (event, ctx) => {
		if (event.toolName !== "write-todos") return;
		updateUI(ctx);
		syncWidget(ctx);
	});

	// Rebuild state from the session branch on load, switch, and tree navigate,
	// so the status, widget, and /todos match the current point in history.
	const refreshFromSession = async (_event: unknown, ctx: ExtensionContext): Promise<void> => {
		reconstructState(ctx);
		updateUI(ctx);
		syncWidget(ctx);
	};
	pi.on("session_start", refreshFromSession);
	pi.on("session_tree", refreshFromSession);
}