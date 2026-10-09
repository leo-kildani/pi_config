/**
 * Pure todo-list resolution for the write-todos tool.
 *
 * No external imports and no IO, so the module is safe to unit-test in
 * isolation. All mutable state lives in index.ts; this module only transforms
 * input into output.
 */

export type TodoStatus = "pending" | "in_progress" | "completed" | "cancelled";

export const TODO_STATUSES: readonly TodoStatus[] = ["pending", "in_progress", "completed", "cancelled"];

export interface Todo {
	id: string;
	content: string;
	status: TodoStatus;
}

/** One entry as passed to the tool. Omitted content/status means keep for existing ids. */
export interface TodoEntry {
	id: string;
	content?: string;
	status?: TodoStatus;
}

export function isTodoStatus(v: unknown): v is TodoStatus {
	return v === "pending" || v === "in_progress" || v === "completed" || v === "cancelled";
}

/** Ids that appear more than once in one call, in first-seen order. */
export function findDuplicateIds(entries: TodoEntry[]): string[] {
	const seen = new Set<string>();
	const dupes: string[] = [];
	for (const entry of entries) {
		if (seen.has(entry.id) && !dupes.includes(entry.id)) {
			dupes.push(entry.id);
		}
		seen.add(entry.id);
	}
	return dupes;
}

export type ResolveResult = { ok: true; todos: Todo[] } | { ok: false; error: string };

/**
 * Replace the old list with the passed entries.
 *
 * - Existing id: keeps current content and status when omitted. An explicitly
 *   blank content counts as omitted.
 * - New id: needs non-blank content; status defaults to pending.
 * - Duplicate ids in one call: whole call rejected, state unchanged.
 */
export function resolveTodos(oldTodos: Todo[], entries: TodoEntry[]): ResolveResult {
	const dupes = findDuplicateIds(entries);
	if (dupes.length > 0) {
		return {
			ok: false,
			error:
				`Duplicate todo id${dupes.length > 1 ? "s" : ""} in one call: ${dupes.join(", ")}. ` +
				"Each id may appear only once.",
		};
	}

	const next: Todo[] = [];
	for (const entry of entries) {
		const existing = oldTodos.find((t) => t.id === entry.id);
		if (existing) {
			next.push({
				id: existing.id,
				content: entry.content?.trim() ? entry.content : existing.content,
				status: entry.status ?? existing.status,
			});
		} else {
			if (!entry.content?.trim()) {
				return { ok: false, error: `Todo ${entry.id} is new; content is required.` };
			}
			next.push({
				id: entry.id,
				content: entry.content,
				status: entry.status ?? "pending",
			});
		}
	}
	return { ok: true, todos: next };
}

/**
 * Validate an untrusted todos value. Tool-result details come from the session
 * file, which is external input. Returns a clean list, or undefined when the
 * value is not an array. Entries without valid id, content, and status are
 * skipped.
 */
export function sanitizeTodos(value: unknown): Todo[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const clean: Todo[] = [];
	for (const item of value) {
		if (typeof item !== "object" || item === null) continue;
		const record = item as Record<string, unknown>;
		if (typeof record.id !== "string" || typeof record.content !== "string") continue;
		if (!isTodoStatus(record.status)) continue;
		clean.push({ id: record.id, content: record.content, status: record.status });
	}
	return clean;
}