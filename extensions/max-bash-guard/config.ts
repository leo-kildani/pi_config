/**
 * Configuration for the max-bash-guard extension.
 *
 * The guard mode is free, trial, or jail. The default mode comes from the
 * PI_MAX_BASH_GUARD_MODE environment variable. The checker settings control the
 * probabilistic layer.
 */

export type PolicyProfile = "strict" | "balanced" | "permissive";
export type GuardMode = "free" | "trial" | "jail";

export interface MaxBashGuardConfig {
	mode: GuardMode;
	checkerCount: number;
	minSafeVotes: number;
	checkerTimeoutMs: number;
	policyProfile: PolicyProfile;
}

export function parseGuardMode(value: string | undefined, defaultValue: GuardMode): GuardMode {
	if (value === undefined) return defaultValue;
	const normalized = value.trim().toLowerCase();
	return normalized === "free" || normalized === "trial" || normalized === "jail" ? normalized : defaultValue;
}

export function parsePolicyProfile(value: string | undefined, defaultValue: PolicyProfile): PolicyProfile {
	if (value === undefined) return defaultValue;
	const normalized = value.trim().toLowerCase();
	return normalized === "strict" || normalized === "balanced" || normalized === "permissive" ? normalized : defaultValue;
}

export function parseIntegerEnv(value: string | undefined, defaultValue: number, min = 0): number {
	if (value === undefined) return defaultValue;
	const parsed = Number.parseInt(value.trim(), 10);
	return Number.isFinite(parsed) && parsed >= min ? parsed : defaultValue;
}

export const DEFAULT_MODE = parseGuardMode(process.env.PI_MAX_BASH_GUARD_MODE, "jail");

export const DEFAULT_CONFIG: MaxBashGuardConfig = {
	mode: DEFAULT_MODE,
	checkerCount: parseIntegerEnv(process.env.PI_MAX_BASH_GUARD_CHECKERS, 3, 1),
	minSafeVotes: parseIntegerEnv(process.env.PI_MAX_BASH_GUARD_MIN_SAFE_VOTES, 2, 1),
	checkerTimeoutMs: parseIntegerEnv(process.env.PI_MAX_BASH_GUARD_CHECKER_TIMEOUT_MS, 20_000, 100),
	policyProfile: parsePolicyProfile(process.env.PI_MAX_BASH_GUARD_POLICY_PROFILE, "balanced"),
};
