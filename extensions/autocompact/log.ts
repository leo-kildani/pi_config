/**
 * Append-only JSONL log for the autocompact extension.
 *
 * Writes one JSON object per line to `autocompact.logs` next to the source
 * (override with `PI_AUTOCOMPACT_LOG_PATH`). Every write failure is swallowed;
 * logging must never break a decision.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const EXTENSION_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_LOG_PATH = join(EXTENSION_DIR, "autocompact.logs");

/** Resolve the log path at call time so tests can override it. */
export function logPath(): string {
	return process.env.PI_AUTOCOMPACT_LOG_PATH ?? DEFAULT_LOG_PATH;
}

/** Append one JSON line. Never throws. */
export function logEvent(event: string, data: Record<string, unknown> = {}): void {
	try {
		const line = `${JSON.stringify({ ts: new Date().toISOString(), event, ...data })}\n`;
		mkdirSync(dirname(logPath()), { recursive: true });
		appendFileSync(logPath(), line, "utf8");
	} catch {
		// Logging must never break the extension.
	}
}
