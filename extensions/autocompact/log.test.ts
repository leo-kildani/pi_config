import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { logEvent, logPath } from "./log.ts";

test("logPath honors the PI_AUTOCOMPACT_LOG_PATH override", () => {
	const target = join(tmpdir(), `autocompact-${process.pid}-path.logs`);
	process.env.PI_AUTOCOMPACT_LOG_PATH = target;
	try {
		assert.equal(logPath(), target);
	} finally {
		delete process.env.PI_AUTOCOMPACT_LOG_PATH;
	}
});

test("logEvent appends one parseable JSON line", () => {
	const dir = mkdtempSync(join(tmpdir(), "autocompact-log-"));
	const target = join(dir, "autocompact.logs");
	process.env.PI_AUTOCOMPACT_LOG_PATH = target;
	try {
		logEvent("decision", { tier: "request", action: "compact" });
		const lines = readFileSync(target, "utf8").trim().split("\n");
		assert.equal(lines.length, 1);
		const entry = JSON.parse(lines[0]);
		assert.equal(typeof entry.ts, "string");
		assert.equal(entry.event, "decision");
		assert.equal(entry.tier, "request");
		assert.equal(entry.action, "compact");
	} finally {
		delete process.env.PI_AUTOCOMPACT_LOG_PATH;
		rmSync(dir, { recursive: true, force: true });
	}
});

test("logEvent swallows write errors", () => {
	const dir = mkdtempSync(join(tmpdir(), "autocompact-log-"));
	const blocker = join(dir, "blocker");
	writeFileSync(blocker, "not a directory");
	process.env.PI_AUTOCOMPACT_LOG_PATH = join(blocker, "nested", "autocompact.logs");
	try {
		assert.doesNotThrow(() => logEvent("decision", { tier: "silent" }));
	} finally {
		delete process.env.PI_AUTOCOMPACT_LOG_PATH;
		rmSync(dir, { recursive: true, force: true });
	}
});

test("logEvent does not throw on a circular value", () => {
	const dir = mkdtempSync(join(tmpdir(), "autocompact-log-"));
	process.env.PI_AUTOCOMPACT_LOG_PATH = join(dir, "autocompact.logs");
	const circular: Record<string, unknown> = {};
	circular.self = circular;
	try {
		assert.doesNotThrow(() => logEvent("decision", { circular }));
	} finally {
		delete process.env.PI_AUTOCOMPACT_LOG_PATH;
		rmSync(dir, { recursive: true, force: true });
	}
});
