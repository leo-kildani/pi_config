/**
 * Configuration for the max-bash-guard extension.
 *
 * The guard mode is free, trial, jail, or read-only. The default mode comes from
 * the PI_MAX_BASH_GUARD_MODE environment variable. The checker settings control
 * the probabilistic layer.
 */

export type GuardMode = "free" | "trial" | "jail" | "read-only";
export type CheckerCount = 1 | 3 | 5;
export const CHECKER_COUNTS: readonly CheckerCount[] = [1, 3, 5];

export interface MaxBashGuardConfig {
	mode: GuardMode;
	checkerCount: CheckerCount;
	checkerModel?: string;
	minSafeVotes: number;
	checkerTimeoutMs: number;
}

export function parseGuardMode(value: string | undefined, defaultValue: GuardMode): GuardMode {
	if (value === undefined) return defaultValue;
	const normalized = value.trim().toLowerCase();
	return normalized === "free" || normalized === "trial" || normalized === "jail" || normalized === "read-only" ? normalized : defaultValue;
}

export function parseCheckerCount(value: string | undefined, defaultValue: CheckerCount): CheckerCount {
	if (value === undefined) return defaultValue;
	const parsed = Number(value.trim());
	return CHECKER_COUNTS.includes(parsed as CheckerCount) ? parsed as CheckerCount : defaultValue;
}

export function scaleMinSafeVotes(checkerCount: CheckerCount, baseCount: CheckerCount, baseMinSafeVotes: number): number {
	return Math.min(checkerCount, Math.ceil((checkerCount * baseMinSafeVotes) / baseCount));
}

export function parseIntegerEnv(value: string | undefined, defaultValue: number, min = 0): number {
	if (value === undefined) return defaultValue;
	const parsed = Number.parseInt(value.trim(), 10);
	return Number.isFinite(parsed) && parsed >= min ? parsed : defaultValue;
}

export const DEFAULT_MODE = parseGuardMode(process.env.PI_MAX_BASH_GUARD_MODE, "read-only");

export const DEFAULT_CONFIG: MaxBashGuardConfig = {
	mode: DEFAULT_MODE,
	checkerCount: parseCheckerCount(process.env.PI_MAX_BASH_GUARD_CHECKERS, 3),
	minSafeVotes: parseIntegerEnv(process.env.PI_MAX_BASH_GUARD_MIN_SAFE_VOTES, 2, 1),
	checkerTimeoutMs: parseIntegerEnv(process.env.PI_MAX_BASH_GUARD_CHECKER_TIMEOUT_MS, 20_000, 100),
};
