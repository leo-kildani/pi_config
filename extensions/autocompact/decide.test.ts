import assert from "node:assert/strict";
import { test } from "node:test";
import {
	buildJudgmentContext,
	buildState,
	decide,
	recallGuideline,
	type CompactConfig,
	type CompactJudgment,
	type CompactUsage,
} from "./decide.ts";

const CONFIG: CompactConfig = {
	enabled: true,
	noticeTokens: 40_000,
	recommendedTokens: 70_000,
	highWaterTokens: 100_000,
	taskShiftThreshold: 0.6,
	cooldownTurns: 2,
};

const usage = (tokens: number | null): CompactUsage => ({ tokens });

const judgment = (over: Partial<CompactJudgment> = {}): CompactJudgment => ({
	objective_shift: 0.9,
	at_boundary: 0.9,
	mid_operation: 0.05,
	needs_history: 0.05,
	...over,
});

const decideWith = (
	tokens: number | null,
	answers: CompactJudgment | null,
	over: {
		config?: Partial<CompactConfig>;
		keepRecentTokens?: number;
		onCooldown?: boolean;
		compactionPending?: boolean;
	} = {},
) =>
	decide({
		usage: usage(tokens),
		judgment: answers,
		config: { ...CONFIG, ...over.config },
		keepRecentTokens: over.keepRecentTokens ?? 20_000,
		onCooldown: over.onCooldown ?? false,
		compactionPending: over.compactionPending ?? false,
	});

test("compacts on a task shift at the recommended band", () => {
	const decision = decideWith(80_000, judgment());
	assert.equal(decision.action, "compact");
	assert.equal(decision.tier, "request");
});

test("holds when the agent is mid-operation", () => {
	const decision = decideWith(80_000, judgment({ mid_operation: 0.9 }));
	assert.equal(decision.action, "none");
	assert.equal(decision.tier, "recommend");
});

test("holds when the answer still needs history", () => {
	const decision = decideWith(80_000, judgment({ needs_history: 0.9 }));
	assert.equal(decision.action, "none");
});

test("holds when the request continues the same objective", () => {
	const decision = decideWith(80_000, judgment({ objective_shift: 0.2 }));
	assert.equal(decision.action, "none");
});

test("holds when the request is not self-contained", () => {
	const decision = decideWith(80_000, judgment({ at_boundary: 0.2 }));
	assert.equal(decision.action, "none");
});

test("holds at the recommended band when judgment is unavailable", () => {
	const decision = decideWith(80_000, null);
	assert.equal(decision.action, "none");
	assert.equal(decision.tier, "recommend");
});

test("stays silent when context fits in keepRecentTokens", () => {
	const decision = decideWith(80_000, judgment(), { keepRecentTokens: 80_000 });
	assert.equal(decision.action, "none");
	assert.equal(decision.tier, "silent");
});

test("stays silent when tokens are unknown", () => {
	const decision = decideWith(null, judgment());
	assert.equal(decision.action, "none");
	assert.equal(decision.tier, "silent");
});

test("stays silent when disabled", () => {
	const decision = decideWith(80_000, judgment(), { config: { enabled: false } });
	assert.equal(decision.action, "none");
	assert.equal(decision.tier, "silent");
});

test("stays silent during the cooldown", () => {
	const decision = decideWith(80_000, judgment(), { onCooldown: true });
	assert.equal(decision.action, "none");
	assert.equal(decision.tier, "silent");
});

test("stays silent below the notice band", () => {
	const decision = decideWith(30_000, judgment());
	assert.equal(decision.action, "none");
	assert.equal(decision.tier, "silent");
});

test("notices between the notice and recommended bands", () => {
	const decision = decideWith(50_000, null);
	assert.equal(decision.action, "none");
	assert.equal(decision.tier, "notice");
});

test("notices exactly at noticeTokens", () => {
	const decision = decideWith(40_000, null);
	assert.equal(decision.action, "none");
	assert.equal(decision.tier, "notice");
});

test("judges exactly at recommendedTokens", () => {
	const decision = decideWith(70_000, judgment());
	assert.equal(decision.action, "compact");
	assert.equal(decision.tier, "request");
});

test("compacts on a new objective within the same project", () => {
	const decision = decideWith(80_000, judgment({ objective_shift: 0.8 }));
	assert.equal(decision.action, "compact");
});

test("compacts at high water without a classifier judgment", () => {
	const decision = decideWith(100_000, null);
	assert.equal(decision.action, "compact");
	assert.equal(decision.reason, "high-water");
});

test("high water overrides cooldown", () => {
	const decision = decideWith(100_000, null, { onCooldown: true });
	assert.equal(decision.action, "compact");
});

test("high water still respects the keep-recent floor", () => {
	const decision = decideWith(100_000, null, { keepRecentTokens: 100_000 });
	assert.equal(decision.action, "none");
});

test("high water does not start a second pending compaction", () => {
	const decision = decideWith(100_000, null, { compactionPending: true });
	assert.equal(decision.action, "none");
});

test("recallGuideline returns a bullet when the summary lacks vcc_recall", () => {
	const guideline = recallGuideline("Earlier we built the widget.");
	assert.ok(guideline);
	assert.match(guideline, /vcc_recall/);
});

test("recallGuideline returns null when the summary mentions vcc_recall", () => {
	assert.equal(recallGuideline("Use vcc_recall to look up earlier detail."), null);
});

test("recallGuideline returns a bullet for an empty summary", () => {
	assert.ok(recallGuideline(""));
});

test("buildState clips the current request", () => {
	const long = "x".repeat(1000);
	const state = buildState({
		prompt: long,
		userMessages: [],
		lastAssistantText: "",
		lastSummary: "",
		toolNames: [],
		usage: usage(80_000),
		keepRecentTokens: 20_000,
	});
	assert.ok(state.current_request.length <= 600);
	assert.ok(state.current_request.endsWith("…"));
});

test("buildState folds the last summary into previous work", () => {
	const state = buildState({
		prompt: "do the next thing",
		userMessages: ["first request"],
		lastAssistantText: "some answer",
		lastSummary: "we already built the widget",
		toolNames: ["read", "edit"],
		usage: usage(80_000),
		keepRecentTokens: 20_000,
	});
	assert.match(state.previous_work, /we already built the widget/);
	assert.match(state.previous_work, /first request/);
	assert.equal(state.current_request, "do the next thing");
	assert.equal(state.recent_turn, "some answer");
	assert.equal(state.tools_this_turn, "read, edit");
	assert.equal(state.context.tokens, 80_000);
	assert.equal(state.context.keepRecentTokens, 20_000);
});

test("buildState caps previous work at five messages", () => {
	const state = buildState({
		prompt: "p",
		userMessages: ["m1", "m2", "m3", "m4", "m5", "m6", "m7"],
		lastAssistantText: "",
		lastSummary: "",
		toolNames: [],
		usage: usage(80_000),
		keepRecentTokens: 20_000,
	});
	assert.match(state.previous_work, /m3/);
	assert.match(state.previous_work, /m7/);
	assert.doesNotMatch(state.previous_work, /m1/);
	assert.doesNotMatch(state.previous_work, /m2/);
});

test("buildState clips a long tool list", () => {
	const tools = Array.from({ length: 300 }, (_, i) => `tool${i}`);
	const state = buildState({
		prompt: "p",
		userMessages: [],
		lastAssistantText: "",
		lastSummary: "",
		toolNames: tools,
		usage: usage(80_000),
		keepRecentTokens: 20_000,
	});
	assert.equal(state.tools_this_turn.length, 200);
	assert.ok(state.tools_this_turn.endsWith("…"));
});

test("buildJudgmentContext asks four bool questions in a Record", () => {
	const state = buildState({
		prompt: "p",
		userMessages: [],
		lastAssistantText: "",
		lastSummary: "",
		toolNames: [],
		usage: usage(80_000),
		keepRecentTokens: 20_000,
	});
	const context = buildJudgmentContext(state);
	assert.deepEqual(Object.keys(context.questions).sort(), [
		"at_boundary",
		"mid_operation",
		"needs_history",
		"objective_shift",
	]);
	for (const question of Object.values(context.questions)) {
		assert.equal(question.type, "bool");
	}
	assert.equal(context.state, state);
});
