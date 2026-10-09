import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DEFAULT_SETTINGS, loadSettings } from "./config.ts";

function withConfig(contents: string | null, run: () => void): void {
	const dir = mkdtempSync(join(tmpdir(), "autocompact-config-"));
	const path = join(dir, "autocompact-config.json");
	if (contents != null) writeFileSync(path, contents);
	process.env.PI_AUTOCOMPACT_CONFIG_PATH = path;
	try {
		run();
	} finally {
		delete process.env.PI_AUTOCOMPACT_CONFIG_PATH;
		rmSync(dir, { recursive: true, force: true });
	}
}

test("missing config returns the defaults", () => {
	withConfig(null, () => {
		assert.deepEqual(loadSettings(), DEFAULT_SETTINGS);
	});
});

test("valid config values are preserved", () => {
	withConfig(
		JSON.stringify({
			enabled: false,
			noticeTokens: 10_000,
			recommendedTokens: 20_000,
			highWaterTokens: 30_000,
			taskShiftThreshold: 0.4,
			cooldownTurns: 5,
		}),
		() => {
			assert.deepEqual(loadSettings(), {
				enabled: false,
				noticeTokens: 10_000,
				recommendedTokens: 20_000,
				highWaterTokens: 30_000,
				taskShiftThreshold: 0.4,
				cooldownTurns: 5,
			});
		},
	);
});

test("high-water below the recommended band resets all token bands", () => {
	withConfig(JSON.stringify({ noticeTokens: 10_000, recommendedTokens: 20_000, highWaterTokens: 15_000 }), () => {
		const settings = loadSettings();
		assert.equal(settings.noticeTokens, DEFAULT_SETTINGS.noticeTokens);
		assert.equal(settings.recommendedTokens, DEFAULT_SETTINGS.recommendedTokens);
		assert.equal(settings.highWaterTokens, DEFAULT_SETTINGS.highWaterTokens);
	});
});

test("out-of-order bands fall back together to the defaults", () => {
	withConfig(
		JSON.stringify({
			noticeTokens: 90_000,
			recommendedTokens: 70_000,
			taskShiftThreshold: 0.4,
		}),
		() => {
			const settings = loadSettings();
			assert.equal(settings.noticeTokens, DEFAULT_SETTINGS.noticeTokens);
			assert.equal(settings.recommendedTokens, DEFAULT_SETTINGS.recommendedTokens);
			assert.equal(settings.taskShiftThreshold, 0.4);
		},
	);
});

test("out-of-range taskShiftThreshold falls back to the default", () => {
	withConfig(JSON.stringify({ taskShiftThreshold: 1.5 }), () => {
		assert.equal(loadSettings().taskShiftThreshold, DEFAULT_SETTINGS.taskShiftThreshold);
	});
});

test("negative cooldownTurns falls back to the default", () => {
	withConfig(JSON.stringify({ cooldownTurns: -1 }), () => {
		assert.equal(loadSettings().cooldownTurns, DEFAULT_SETTINGS.cooldownTurns);
	});
});
