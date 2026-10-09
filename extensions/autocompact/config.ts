/**
 * Config for the autocompact extension.
 *
 * Reads `~/.pi/agent/autocompact-config.json` (override with
 * `PI_AUTOCOMPACT_CONFIG_PATH`). Missing or malformed files fall back to
 * defaults. `scaffoldSettings` writes the default block on first load.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const DEFAULT_PATH = join(homedir(), ".pi", "agent", "autocompact-config.json");

function settingsPath(): string {
	return process.env.PI_AUTOCOMPACT_CONFIG_PATH ?? DEFAULT_PATH;
}

export interface AutocompactSettings {
	/** Master switch. When false, the extension loads but never acts. */
	enabled: boolean;
	/** Estimated context tokens that trigger the UI notice. */
	noticeTokens: number;
	/** Token count that triggers the classifier relevance judgment. */
	recommendedTokens: number;
	/** Token count that forces compaction without a classifier judgment. */
	highWaterTokens: number;
	/** An `objective_shift` probability above this counts as a new objective. */
	taskShiftThreshold: number;
	/** Turns to wait after a compaction before acting again. */
	cooldownTurns: number;
}

export const DEFAULT_SETTINGS: AutocompactSettings = {
	enabled: true,
	noticeTokens: 40_000,
	recommendedTokens: 70_000,
	highWaterTokens: 100_000,
	taskShiftThreshold: 0.6,
	cooldownTurns: 2,
};

function readJson(path: string): Record<string, unknown> | null {
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf-8"));
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
		}
		return null;
	} catch {
		return null;
	}
}

function coerceNumber(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function validNumber(value: unknown, fallback: number, ok: (n: number) => boolean): number {
	const n = coerceNumber(value, fallback);
	return ok(n) ? n : fallback;
}

/** Load the merged settings. Malformed values fall back per key to the default. */
export function loadSettings(): AutocompactSettings {
	const parsed = readJson(settingsPath());
	if (!parsed) return { ...DEFAULT_SETTINGS };

	const noticeTokens = coerceNumber(parsed.noticeTokens, DEFAULT_SETTINGS.noticeTokens);
	const recommendedTokens = coerceNumber(
		parsed.recommendedTokens,
		DEFAULT_SETTINGS.recommendedTokens,
	);
	const highWaterTokens = coerceNumber(parsed.highWaterTokens, DEFAULT_SETTINGS.highWaterTokens);
	const bandsOrdered = noticeTokens <= recommendedTokens && recommendedTokens <= highWaterTokens;

	return {
		enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : DEFAULT_SETTINGS.enabled,
		noticeTokens: bandsOrdered ? noticeTokens : DEFAULT_SETTINGS.noticeTokens,
		recommendedTokens: bandsOrdered ? recommendedTokens : DEFAULT_SETTINGS.recommendedTokens,
		highWaterTokens: bandsOrdered ? highWaterTokens : DEFAULT_SETTINGS.highWaterTokens,
		taskShiftThreshold: validNumber(
			parsed.taskShiftThreshold,
			DEFAULT_SETTINGS.taskShiftThreshold,
			(n) => n >= 0 && n <= 1,
		),
		cooldownTurns: validNumber(parsed.cooldownTurns, DEFAULT_SETTINGS.cooldownTurns, (n) => n >= 0),
	};
}

/**
 * Ensure the config file exists with the default keys.
 * - Missing file: create it with the full default block.
 * - Invalid JSON: leave it alone.
 * - Valid file: fill in missing keys, keep existing values.
 */
export function scaffoldSettings(): void {
	try {
		const path = settingsPath();
		const dir = dirname(path);
		if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

		if (!existsSync(path)) {
			writeFileSync(path, `${JSON.stringify(DEFAULT_SETTINGS, null, 2)}\n`);
			return;
		}

		const parsed = readJson(path);
		if (!parsed) return;

		let changed = false;
		const next: Record<string, unknown> = { ...parsed };
		for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
			if (!(key in next)) {
				next[key] = value;
				changed = true;
			}
		}
		if (changed) writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`);
	} catch {
		// Config scaffolding is best-effort; never block extension load.
	}
}
