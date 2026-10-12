import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { DEFAULT_CONFIG } from "./config.ts";
import { runCheckers } from "./checkers.ts";

function createContext(models: unknown[], classify: (...args: any[]) => Promise<unknown>) {
	const calls: Array<{ model: unknown; context: unknown; options: unknown }> = [];
	const modelRegistry = {
		getAvailableOfType: async (type: string) => {
			assert.equal(type, "classifier");
			return models;
		},
		classify: async (model: unknown, context: unknown, options: unknown) => {
			calls.push({ model, context, options });
			return classify(model, context, options);
		},
	};
	return {
		ctx: { modelRegistry, scopedModels: [] } as unknown as ExtensionContext,
		calls,
	};
}

function classifierReply(choice: string) {
	return {
		provider: "system-one",
		model: "checker",
		answers: {
			safety: {
				type: "choice",
				choice,
				probabilities: { SAFE: choice === "SAFE" ? 1 : 0, DESTRUCTIVE: choice === "DESTRUCTIVE" ? 1 : 0 },
				confidence: 1,
			},
		},
		stopReason: "stop",
	};
}

describe("runCheckers", () => {
	it("uses the first available classifier by default", async () => {
		const models = [
			{ provider: "one", id: "first" },
			{ provider: "two", id: "second" },
			{ provider: "three", id: "third" },
		];
		const { ctx, calls } = createContext(models, async () => classifierReply("SAFE"));

		const result = await runCheckers(ctx, "rm -rf /tmp/scratch", DEFAULT_CONFIG);

		assert.deepEqual(result.replies, ["safe", "safe", "safe"]);
		assert.deepEqual(calls.map((call) => call.model), [models[0], models[0], models[0]]);
		const request = calls[0]!.context as {
			state: { command: string };
			questions: { safety: { type: string; criteria: Record<string, string> } };
		};
		assert.deepEqual(request.state, { command: "rm -rf /tmp/scratch" });
		assert.equal(request.questions.safety.type, "choice");
		assert.deepEqual(Object.keys(request.questions.safety.criteria), ["SAFE", "DESTRUCTIVE"]);
	});

	it("uses only the selected classifier for each checker vote", async () => {
		const models = [
			{ provider: "one", id: "first" },
			{ provider: "two", id: "second" },
		];
		const { ctx, calls } = createContext(models, async () => classifierReply("SAFE"));

		await runCheckers(ctx, "touch /tmp/file", {
			...DEFAULT_CONFIG,
			checkerCount: 3,
			checkerModel: "two/second",
		});

		assert.deepEqual(calls.map((call) => call.model), [models[1], models[1], models[1]]);
	});

	it("fails closed when the selected classifier is no longer available", async () => {
		const models = [{ provider: "one", id: "first" }];
		const { ctx, calls } = createContext(models, async () => classifierReply("SAFE"));

		const result = await runCheckers(ctx, "touch /tmp/file", {
			...DEFAULT_CONFIG,
			checkerCount: 1,
			checkerModel: "missing/model",
		});

		assert.deepEqual(result.replies, []);
		assert.deepEqual(result.errors, ["Selected checker model is unavailable: missing/model"]);
		assert.equal(calls.length, 0);
	});

	it("treats unrecognized classifier choices as unknown votes", async () => {
		const { ctx } = createContext([{ provider: "one", id: "first" }], async () => classifierReply("SAFE-ish"));

		const result = await runCheckers(ctx, "touch /tmp/file", {
			...DEFAULT_CONFIG,
			checkerCount: 1,
		});

		assert.deepEqual(result.replies, ["unknown"]);
		assert.deepEqual(result.errors, ["Unexpected checker reply for one/first"]);
	});

	it("counts classifier API failures as unknown votes", async () => {
		const { ctx } = createContext([{ provider: "one", id: "first" }], async () => ({
			provider: "one",
			model: "first",
			answers: {},
			stopReason: "error",
			errorMessage: "service unavailable",
		}));

		const result = await runCheckers(ctx, "touch /tmp/file", {
			...DEFAULT_CONFIG,
			checkerCount: 1,
		});

		assert.deepEqual(result.replies, ["unknown"]);
		assert.equal(result.summary.unknown, 1);
		assert.deepEqual(result.errors, ["service unavailable"]);
	});
});
