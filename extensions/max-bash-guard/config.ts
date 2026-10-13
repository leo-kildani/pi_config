/**
 * Configuration for the max-bash-guard extension.
 *
 * The guard mode is off, on, or read-only. The default mode comes from the
 * PI_MAX_BASH_GUARD_MODE environment variable. The checker setting controls the
 * single probabilistic layer.
 */

export type GuardMode = "off" | "on" | "read-only";

export interface MaxBashGuardConfig {
	mode: GuardMode;
	checkerEnabled: boolean;
	checkerModel?: string;
	checkerTimeoutMs: number;
}

const LEGACY_MODES: Record<string, GuardMode> = {
	free: "off",
	trial: "on",
	jail: "on",
};

export function parseGuardMode(value: string | undefined, defaultValue: GuardMode): GuardMode {
	if (value === undefined) return defaultValue;
	const normalized = value.trim().toLowerCase();
	if (normalized === "off" || normalized === "on" || normalized === "read-only") return normalized;
	return LEGACY_MODES[normalized] ?? defaultValue;
}

export function parseCheckerEnabled(value: string | undefined, defaultValue: boolean): boolean {
	if (value === undefined) return defaultValue;
	const normalized = value.trim().toLowerCase();
	if (normalized === "on" || normalized === "true" || normalized === "1") return true;
	if (normalized === "off" || normalized === "false" || normalized === "0") return false;
	return defaultValue;
}

export function parseIntegerEnv(value: string | undefined, defaultValue: number, min = 0): number {
	if (value === undefined) return defaultValue;
	const parsed = Number.parseInt(value.trim(), 10);
	return Number.isFinite(parsed) && parsed >= min ? parsed : defaultValue;
}

export const DEFAULT_MODE = parseGuardMode(process.env.PI_MAX_BASH_GUARD_MODE, "read-only");

export const DEFAULT_CONFIG: MaxBashGuardConfig = {
	mode: DEFAULT_MODE,
	checkerEnabled: parseCheckerEnabled(process.env.PI_MAX_BASH_GUARD_CHECKER, true),
	checkerTimeoutMs: parseIntegerEnv(process.env.PI_MAX_BASH_GUARD_CHECKER_TIMEOUT_MS, 20_000, 100),
};
