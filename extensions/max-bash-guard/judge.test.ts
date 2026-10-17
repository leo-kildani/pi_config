import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { DEFAULT_CONFIG } from "./config.ts";
import { HARM_REASONS, judgeCommand } from "./judge.ts";

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
		model: "judge",
		answers: {
			verdict: {
				type: "choice",
				choice,
				probabilities: { [choice]: 1 },
				confidence: 1,
			},
		},
		stopReason: "stop",
	};
}

describe("judgeCommand", () => {
	it("treats NOT_HARMFUL as safe and offers every choice", async () => {
		const models = [
			{ provider: "one", id: "first" },
			{ provider: "two", id: "second" },
		];
		const { ctx, calls } = createContext(models, async () => classifierReply("NOT_HARMFUL"));

		const result = await judgeCommand(ctx, "rm -rf /tmp/scratch", DEFAULT_CONFIG);

		assert.deepEqual(result, { harmful: false });
		assert.equal(calls.length, 1);
		assert.deepEqual(calls.map((call) => call.model), [models[0]]);
		const request = calls[0]!.context as {
			state: { command: string };
			questions: { verdict: { type: string; criteria: Record<string, string> } };
		};
		assert.deepEqual(request.state, { command: "rm -rf /tmp/scratch" });
		assert.equal(request.questions.verdict.type, "choice");
		assert.deepEqual(
			Object.keys(request.questions.verdict.criteria),
			["NOT_HARMFUL", ...Object.keys(HARM_REASONS)],
		);
	});

	it("returns the display term for a harm choice", async () => {
		const { ctx } = createContext([{ provider: "one", id: "first" }], async () => classifierReply("DATA_DESTRUCTION"));

		const result = await judgeCommand(ctx, "rm -rf /tmp/scratch", DEFAULT_CONFIG);

		assert.deepEqual(result, { harmful: true, reason: "data destruction" });
	});

	it("uses the selected classifier", async () => {
		const models = [
			{ provider: "one", id: "first" },
			{ provider: "two", id: "second" },
		];
		const { ctx, calls } = createContext(models, async () => classifierReply("NOT_HARMFUL"));

		await judgeCommand(ctx, "touch /tmp/file", {
			...DEFAULT_CONFIG,
			checkerModel: "two/second",
		});

		assert.deepEqual(calls.map((call) => call.model), [models[1]]);
	});

	it("fails closed when the selected classifier is no longer available", async () => {
		const models = [{ provider: "one", id: "first" }];
		const { ctx, calls } = createContext(models, async () => classifierReply("NOT_HARMFUL"));

		const result = await judgeCommand(ctx, "touch /tmp/file", {
			...DEFAULT_CONFIG,
			checkerModel: "missing/model",
		});

		assert.deepEqual(result, { harmful: true, reason: "judge model is unavailable: missing/model" });
		assert.equal(calls.length, 0);
	});

	it("fails closed when no classifier is available", async () => {
		const { ctx } = createContext([], async () => classifierReply("NOT_HARMFUL"));

		const result = await judgeCommand(ctx, "touch /tmp/file", DEFAULT_CONFIG);

		assert.deepEqual(result, { harmful: true, reason: "no judge model is available" });
	});

	it("fails closed when the classifier returns an unrecognized verdict", async () => {
		const { ctx } = createContext([{ provider: "one", id: "first" }], async () => classifierReply("SAFE-ish"));

		const result = await judgeCommand(ctx, "touch /tmp/file", DEFAULT_CONFIG);

		assert.deepEqual(result, {
			harmful: true,
			reason: "judge returned an unknown verdict from one/first: SAFE-ish",
		});
	});

	it("fails closed on a classifier API failure", async () => {
		const { ctx } = createContext([{ provider: "one", id: "first" }], async () => ({
			provider: "one",
			model: "first",
			answers: {},
			stopReason: "error",
			errorMessage: "service unavailable",
		}));

		const result = await judgeCommand(ctx, "touch /tmp/file", DEFAULT_CONFIG);

		assert.deepEqual(result, { harmful: true, reason: "judge failed: service unavailable" });
	});

	it("fails closed when the classifier times out", async () => {
		const { ctx } = createContext([{ provider: "one", id: "first" }], async (_model, _context, options) =>
			new Promise((resolve) => {
				(options as { signal: AbortSignal }).signal.addEventListener("abort", () => resolve({
					provider: "one",
					model: "first",
					answers: {},
					stopReason: "aborted",
				}));
			}));

		const result = await judgeCommand(ctx, "touch /tmp/file", {
			...DEFAULT_CONFIG,
			checkerTimeoutMs: 10,
		});

		assert.deepEqual(result, { harmful: true, reason: "judge failed: timed out after 10ms" });
	});
});
