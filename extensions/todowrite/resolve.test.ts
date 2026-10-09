/**
 * Unit tests for resolve.ts, the pure replace/resolve logic of the write-todos tool.
 * Runs with the Node built-in test runner, no dependencies:
 *   node --experimental-strip-types --test resolve.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { findDuplicateIds, resolveTodos, sanitizeTodos, type Todo } from "./resolve.ts";

const old: Todo[] = [
	{ id: "todo-1", content: "first", status: "pending" },
	{ id: "todo-2", content: "second", status: "in_progress" },
];

describe("resolveTodos", () => {
	it("replaces the old list with the passed entries", () => {
		const res = resolveTodos(old, [{ id: "todo-3", content: "third" }]);
		assert.equal(res.ok, true);
		if (res.ok) {
			assert.deepEqual(res.todos, [{ id: "todo-3", content: "third", status: "pending" }]);
		}
	});

	it("returns an empty list when no entries are passed", () => {
		const res = resolveTodos(old, []);
		assert.equal(res.ok, true);
		if (res.ok) {
			assert.deepEqual(res.todos, []);
		}
	});

	it("keeps omitted content and status on existing ids", () => {
		const res = resolveTodos(old, [{ id: "todo-1" }]);
		assert.equal(res.ok, true);
		if (res.ok) {
			assert.deepEqual(res.todos, [{ id: "todo-1", content: "first", status: "pending" }]);
		}
	});

	it("updates only the fields that are given", () => {
		const res = resolveTodos(old, [{ id: "todo-2", status: "completed" }]);
		assert.equal(res.ok, true);
		if (res.ok) {
			assert.deepEqual(res.todos, [{ id: "todo-2", content: "second", status: "completed" }]);
		}
	});

	it("treats blank content on an existing id as omitted", () => {
		const res = resolveTodos(old, [{ id: "todo-2", content: "   " }]);
		assert.equal(res.ok, true);
		if (res.ok) {
			assert.deepEqual(res.todos, [{ id: "todo-2", content: "second", status: "in_progress" }]);
		}
	});

	it("rejects a new id without content", () => {
		const res = resolveTodos(old, [{ id: "todo-9" }]);
		assert.equal(res.ok, false);
		if (!res.ok) {
			assert.match(res.error, /todo-9/);
			assert.match(res.error, /content is required/);
		}
	});

	it("rejects a new id with blank content", () => {
		const res = resolveTodos(old, [{ id: "todo-9", content: "  " }]);
		assert.equal(res.ok, false);
	});

	it("rejects duplicate ids in one call", () => {
		const res = resolveTodos(old, [
			{ id: "todo-1", status: "completed" },
			{ id: "todo-1", status: "pending" },
		]);
		assert.equal(res.ok, false);
		if (!res.ok) {
			assert.match(res.error, /todo-1/);
		}
	});

	it("reports all duplicate ids, not just the first", () => {
		const res = resolveTodos(old, [
			{ id: "todo-1" },
			{ id: "todo-2" },
			{ id: "todo-1" },
			{ id: "todo-2" },
		]);
		assert.equal(res.ok, false);
		if (!res.ok) {
			assert.match(res.error, /todo-1/);
			assert.match(res.error, /todo-2/);
		}
	});

	it("defaults new ids to pending", () => {
		const res = resolveTodos(old, [
			{ id: "todo-1" },
			{ id: "todo-3", content: "third", status: "cancelled" },
		]);
		assert.equal(res.ok, true);
		if (res.ok) {
			assert.deepEqual(res.todos, [
				{ id: "todo-1", content: "first", status: "pending" },
				{ id: "todo-3", content: "third", status: "cancelled" },
			]);
		}
	});
});

describe("findDuplicateIds", () => {
	it("finds ids used twice or more, in first-seen order", () => {
		assert.deepEqual(findDuplicateIds([{ id: "a" }, { id: "b" }, { id: "a" }, { id: "c" }, { id: "b" }]), ["a", "b"]);
	});

	it("returns an empty array when all ids are unique", () => {
		assert.deepEqual(findDuplicateIds([{ id: "a" }, { id: "b" }, { id: "c" }]), []);
	});
});

describe("sanitizeTodos", () => {
	it("passes valid todos through", () => {
		assert.deepEqual(sanitizeTodos([{ id: "a", content: "x", status: "pending" }]), [
			{ id: "a", content: "x", status: "pending" },
		]);
	});

	it("returns undefined for non-arrays", () => {
		assert.equal(sanitizeTodos(undefined), undefined);
		assert.equal(sanitizeTodos({ todos: [] }), undefined);
		assert.equal(sanitizeTodos("nope"), undefined);
	});

	it("skips entries with missing or invalid fields", () => {
		const cleaned = sanitizeTodos([
			{ id: "a", content: "x", status: "pending" },
			{ id: "b", content: "x", status: "bogus" },
			{ id: "c", status: "pending" },
			null,
			"text",
			{ id: "d", content: "x", status: "completed" },
		]);
		assert.deepEqual(cleaned, [
			{ id: "a", content: "x", status: "pending" },
			{ id: "d", content: "x", status: "completed" },
		]);
	});

	it("returns an empty array for an empty array", () => {
		assert.deepEqual(sanitizeTodos([]), []);
	});
});