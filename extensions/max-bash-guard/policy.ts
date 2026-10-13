/**
 * Deterministic policy for the max-bash-guard extension.
 *
 * The policy flags destructive actions, write actions, and secret disclosure.
 * It does not flag chaining, input redirection, command substitution, or
 * environment expansion by themselves. commandReadsSecrets reports path and
 * environment secret access for the read-only and on modes.
 */

import path from "node:path";

export type PolicyDecision =
	| { action: "none" }
	| { action: "review"; reason: string };

const CLOUD_MUTATION_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
	{ pattern: /^\s*(terraform|terragrunt)\s+.*\b(apply|destroy|import|state\s+(rm|mv|push)|taint|untaint|force-unlock)\b/i, label: "Terraform/Terragrunt state or resource mutation" },
	{ pattern: /^\s*gcloud\s+.*\b(create|update|delete|deploy|enable|disable|set-iam-policy|add-iam-policy-binding|remove-iam-policy-binding|set|unset|auth\s+(login|activate-service-account))\b/i, label: "gcloud cloud-resource or credential mutation" },
	{ pattern: /^\s*(aws|aws-vault)\s+.*\b(create|put|update|delete|remove|attach|detach|authorize|revoke|terminate|start|stop|modify|run-instances|deploy|sync|cp|mv|rm)\b/i, label: "AWS cloud-resource mutation" },
	{ pattern: /^\s*(gsutil|bq)\s+.*\b(cp|mv|rm|setmeta|ch|mk|update|delete|load|query)\b/i, label: "GCP data/resource mutation" },
	{ pattern: /^\s*kubectl\s+.*\b(apply|delete|patch|create|replace|scale|rollout|cordon|drain|taint|annotate|label|exec)\b/i, label: "Kubernetes cluster mutation" },
];

const SENSITIVE_COMMAND_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
	{ pattern: /^\s*(sudo|su)\b/i, label: "privilege escalation" },
	{ pattern: /curl\b.*\|\s*(sh|bash)|wget\b.*\|\s*(sh|bash)/i, label: "remote script execution" },
	{ pattern: /\bchmod\s+(-[^\s]*\s+)?777\b/i, label: "world-writable permissions" },
	{ pattern: /\brm\s+(-[^\s]*r[^\s]*f|-rf|-fr)\s+(["']?)(\/|~|\$\{?HOME\}?|\$\{?PWD\}?)/i, label: "recursive force delete of a broad path" },
];

const ENV_DISCLOSURE_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
	{ pattern: /\bprintenv\b/i, label: "environment variable disclosure" },
	{ pattern: /(^|[\s;&|(])env(\s|$|\))/i, label: "environment variable disclosure" },
	{ pattern: /(^|[\s;&|])set(\s|$)/i, label: "environment variable disclosure" },
	{ pattern: /^\s*jq\s+.*\benv\b/i, label: "environment variable disclosure through jq" },
];

const MUTATION_COMMAND_PATTERN = /^\s*(rm|mv|cp|mkdir|touch|truncate|ln|chmod|chown|install)\b/i;
const WRITE_COMMAND_PATTERN = /^\s*(rm|mv|cp|mkdir|touch|truncate|ln|chmod|chown|install|tee|dd|patch|rsync|scp)\b/i;
const GIT_WRITE_PATTERN = /^\s*git\s+(add|commit|push|pull|fetch|reset|checkout|switch|restore|clean|rm|mv|stash|merge|rebase|cherry-pick|revert|tag)\b/i;
const PACKAGE_WRITE_PATTERN = /^\s*(npm|pnpm|yarn|bun|pip|pip3|poetry|cargo|go)\s+(install|add|remove|uninstall|update|upgrade|publish|ci)\b/i;
const SED_INPLACE_PATTERN = /\bsed\s+(-[^\s]*i|--in-place)/i;
const RECURSIVE_RM_PATTERN = /^\s*rm\s+-[^\s]*r/i;
const SECRET_ENV_NAME = /(SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL|API[_-]?KEY|PRIVATE[_-]?KEY|ACCESS[_-]?KEY|AWS_|GITHUB|NPM_|OPENAI|ANTHROPIC)/i;

const SENSITIVE_PATH_PARTS = new Set([
	".aws",
	".azure",
	".config/gcloud",
	".docker/config.json",
	".git",
	".gnupg",
	".hg",
	".kube",
	".netrc",
	".npmrc",
	".pypirc",
	".ssh",
	".svn",
]);

const SENSITIVE_BASENAMES = new Set([
	".env",
	".env.local",
	".env.production",
	".envrc",
	"credentials",
	"credentials.json",
	"id_rsa",
	"id_dsa",
	"id_ecdsa",
	"id_ed25519",
	"known_hosts",
	"package-lock.json",
	"pnpm-lock.yaml",
	"service-account.json",
	"terraform.tfvars",
	"yarn.lock",
]);

const SENSITIVE_EXTENSIONS = new Set([".key", ".pem", ".p12", ".pfx"]);

export function normalizeCommand(command: string): string {
	// Collapse shell line-continuations and stray newlines for path extraction.
	return command.trim().replace(/\\\n\s*/g, "").replace(/\n\s*/g, " ");
}

function shellWords(command: string): string[] {
	const words: string[] = [];
	let current = "";
	let quote: "'" | '"' | null = null;
	let escaped = false;

	for (const char of command) {
		if (escaped) {
			current += char;
			escaped = false;
			continue;
		}
		if (char === "\\" && quote !== "'") {
			escaped = true;
			continue;
		}
		if ((char === "'" || char === '"') && !quote) {
			quote = char;
			continue;
		}
		if (quote === char) {
			quote = null;
			continue;
		}
		if (!quote && /\s/.test(char)) {
			if (current) words.push(current);
			current = "";
			continue;
		}
		current += char;
	}
	if (current) words.push(current);
	return words;
}

function isLikelyPathArg(arg: string): boolean {
	if (!arg || arg === "--" || arg.startsWith("-")) return false;
	if (/^(https?:|git@|ssh:)/i.test(arg)) return false;
	if (/^(~|\.|\.\.|\/)(\/|$)/.test(arg)) return true;
	if (arg.includes("/")) return true;
	if (SENSITIVE_BASENAMES.has(path.basename(arg))) return true;
	return false;
}

export function extractPathArgs(command: string): string[] {
	const normalized = normalizeCommand(command);
	const words = shellWords(normalized);
	const positional = words.slice(1).filter((arg) => arg !== "--" && !arg.startsWith("-") && !/^(https?:|git@|ssh:)/i.test(arg));
	if (MUTATION_COMMAND_PATTERN.test(normalized)) return positional;
	return positional.filter(isLikelyPathArg);
}

export function resolveCommandPath(arg: string, cwd: string): string {
	const withoutQuotes = arg.replace(/^[']|[']$/g, "").replace(/^[\"]|[\"]$/g, "");
	const expanded = withoutQuotes === "~" || withoutQuotes.startsWith("~/")
		? path.join(process.env.HOME ?? "", withoutQuotes.slice(1))
		: withoutQuotes;
	return path.resolve(cwd, expanded);
}

export function isInside(parent: string, child: string): boolean {
	const rel = path.relative(parent, child);
	return rel === "" || (!!rel && !rel.startsWith("..") && !path.isAbsolute(rel));
}

export function isInTmp(filePath: string): boolean {
	return isInside(path.resolve("/tmp"), filePath) || isInside(path.resolve("/private/tmp"), filePath);
}

export function sensitivePathReason(filePath: string, cwd: string): string | null {
	const relToHome = process.env.HOME ? path.relative(process.env.HOME, filePath) : "";
	const relToCwd = path.relative(cwd, filePath);
	const candidates = [relToHome, relToCwd, filePath].map((p) => p.split(path.sep).join("/"));
	const base = path.basename(filePath);
	const ext = path.extname(filePath);

	if (SENSITIVE_BASENAMES.has(base) || SENSITIVE_EXTENSIONS.has(ext)) return `sensitive file ${base}`;
	for (const candidate of candidates) {
		for (const part of SENSITIVE_PATH_PARTS) {
			if (candidate === part || candidate.startsWith(`${part}/`) || candidate.includes(`/${part}/`)) {
				return `sensitive path ${part}`;
			}
		}
		if (/\b(secret|secrets|credential|credentials|token|tokens)\b/i.test(candidate)) return "path name suggests secrets or credentials";
	}
	return null;
}

function disclosesSecretEnv(command: string): boolean {
	const pattern = /\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g;
	let match: RegExpExecArray | null;
	while ((match = pattern.exec(command)) !== null) {
		if (SECRET_ENV_NAME.test(match[1]!)) return true;
	}
	return false;
}

function hasOutputRedirect(command: string): boolean {
	let quote: "'" | '"' | null = null;
	for (const char of command) {
		if (quote) {
			if (char === quote) quote = null;
			continue;
		}
		if (char === "'" || char === '"') {
			quote = char;
			continue;
		}
		if (char === ">") return true;
	}
	return false;
}

/**
 * Return true when a command reads a sensitive path or discloses environment
 * secrets. The read-only and on modes block a command that reads secrets.
 */
export function commandReadsSecrets(command: string, cwd: string): boolean {
	const normalized = normalizeCommand(command);

	for (const { pattern } of ENV_DISCLOSURE_PATTERNS) {
		if (pattern.test(normalized)) return true;
	}
	if (disclosesSecretEnv(command)) return true;

	const resolvedPaths = extractPathArgs(normalized).map((arg) => resolveCommandPath(arg, cwd));
	return resolvedPaths.some((filePath) => sensitivePathReason(filePath, cwd) !== null);
}

export function evaluateCommandPolicy(command: string, cwd: string): PolicyDecision {
	const normalized = normalizeCommand(command);

	for (const { pattern, label } of CLOUD_MUTATION_PATTERNS) {
		if (pattern.test(normalized)) return { action: "review", reason: label };
	}
	for (const { pattern, label } of SENSITIVE_COMMAND_PATTERNS) {
		if (pattern.test(normalized)) return { action: "review", reason: label };
	}

	const resolvedPaths = extractPathArgs(normalized).map((arg) => resolveCommandPath(arg, cwd));

	for (const filePath of resolvedPaths) {
		const reason = sensitivePathReason(filePath, cwd);
		if (reason) return { action: "review", reason };
	}

	if (MUTATION_COMMAND_PATTERN.test(normalized) && resolvedPaths.length > 0) {
		if (RECURSIVE_RM_PATTERN.test(normalized) && resolvedPaths.some((filePath) => filePath === cwd || isInside(filePath, cwd))) {
			return { action: "review", reason: "recursive delete of current working directory" };
		}
	}

	if (
		WRITE_COMMAND_PATTERN.test(normalized) ||
		GIT_WRITE_PATTERN.test(normalized) ||
		PACKAGE_WRITE_PATTERN.test(normalized) ||
		SED_INPLACE_PATTERN.test(normalized) ||
		hasOutputRedirect(command)
	) {
		return { action: "review", reason: "write or destructive command" };
	}

	return { action: "none" };
}
