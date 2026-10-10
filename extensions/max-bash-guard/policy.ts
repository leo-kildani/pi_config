import { execFileSync } from "node:child_process";
import path from "node:path";
import type { PolicyProfile } from "./config.ts";

export type PolicyDecision =
	| { action: "none" }
	| { action: "allow"; reason: string }
	| { action: "review"; reason: string };

export interface PolicyOptions {
	profile?: PolicyProfile;
}

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
	{ pattern: /^\s*(env|printenv|set)\b/i, label: "environment variable disclosure" },
	{ pattern: /^\s*jq\s+.*\benv\b/i, label: "environment variable disclosure through jq" },
];

const MUTATION_COMMAND_PATTERN = /^\s*(rm|mv|cp|mkdir|touch|truncate|ln|chmod|chown|install)\b/i;
const RECURSIVE_RM_PATTERN = /^\s*rm\s+-[^\s]*r/i;

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
const SHELL_EXPANSION_PATTERN = /\$\{?[A-Za-z_][A-Za-z0-9_]*\}?|\$\{|\$\(|<\(|[?*\[\]{}]/;
const INPUT_REDIRECT_PATTERN = /(^|[^<])<(?!<)/;

export function normalizeCommand(command: string): string {
	// Collapse shell line-continuations only. Unescaped newlines are command
	// separators and must be evaluated before this normalization is used.
	return command.trim().replace(/\\\n\s*/g, "").replace(/\n\s*/g, " ");
}

function hasUnescapedNewline(command: string): boolean {
	for (let i = 0; i < command.length; i++) {
		if (command[i] !== "\n") continue;
		let slashes = 0;
		for (let j = i - 1; j >= 0 && command[j] === "\\"; j--) slashes++;
		if (slashes % 2 === 0) return true;
	}
	return false;
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

function hasShellExpansion(value: string): boolean {
	return SHELL_EXPANSION_PATTERN.test(value);
}

function isLikelyPathArg(arg: string): boolean {
	if (!arg || arg === "--" || arg.startsWith("-")) return false;
	if (/^(https?:|git@|ssh:)/i.test(arg)) return false;
	if (/^(~|\.|\.\.|\/)(\/|$)/.test(arg)) return true;
	if (arg.includes("/")) return true;
	if (SENSITIVE_BASENAMES.has(path.basename(arg))) return true;
	return false;
}

function extractPathArgs(command: string): string[] {
	const normalized = normalizeCommand(command);
	const words = shellWords(normalized);
	const positional = words.slice(1).filter((arg) => arg !== "--" && !arg.startsWith("-") && !/^(https?:|git@|ssh:)/i.test(arg));
	if (MUTATION_COMMAND_PATTERN.test(normalized)) return positional;
	return positional.filter(isLikelyPathArg);
}

function resolveCommandPath(arg: string, cwd: string): string {
	const withoutQuotes = arg.replace(/^[']|[']$/g, "").replace(/^[\"]|[\"]$/g, "");
	const expanded = withoutQuotes === "~" || withoutQuotes.startsWith("~/")
		? path.join(process.env.HOME ?? "", withoutQuotes.slice(1))
		: withoutQuotes;
	return path.resolve(cwd, expanded);
}

function isInside(parent: string, child: string): boolean {
	const rel = path.relative(parent, child);
	return rel === "" || (!!rel && !rel.startsWith("..") && !path.isAbsolute(rel));
}

function isInTmp(filePath: string): boolean {
	return isInside(path.resolve("/tmp"), filePath) || isInside(path.resolve("/private/tmp"), filePath);
}

function sensitivePathReason(filePath: string, cwd: string): string | null {
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

function trackedPathsFor(cwd: string, filePaths: string[]): { insideGitWorkTree: boolean; tracked: Set<string> } {
	const rels = filePaths
		.filter((filePath) => isInside(cwd, filePath))
		.map((filePath) => path.relative(cwd, filePath).split(path.sep).join("/"))
		.filter((rel) => rel && rel !== ".");
	if (rels.length === 0) return { insideGitWorkTree: true, tracked: new Set() };

	try {
		execFileSync("git", ["-C", cwd, "rev-parse", "--is-inside-work-tree"], { stdio: "ignore", timeout: 1000 });
	} catch {
		return { insideGitWorkTree: false, tracked: new Set() };
	}

	try {
		const output = execFileSync("git", ["-C", cwd, "ls-files", "-z", "--", ...rels], {
			encoding: "utf8",
			maxBuffer: 1024 * 1024,
			timeout: 2000,
		});
		return { insideGitWorkTree: true, tracked: new Set(output.split("\0").filter(Boolean)) };
	} catch {
		return { insideGitWorkTree: true, tracked: new Set() };
	}
}

function hasTrackedMatch(cwd: string, filePath: string, tracked: ReadonlySet<string>): boolean {
	const rel = path.relative(cwd, filePath).split(path.sep).join("/");
	return tracked.has(rel) || Array.from(tracked).some((trackedPath) => trackedPath.startsWith(`${rel}/`));
}

function isFreelyMutablePath(cwd: string, filePath: string, git: { insideGitWorkTree: boolean; tracked: ReadonlySet<string> }): boolean {
	if (isInTmp(filePath)) return true;
	if (!git.insideGitWorkTree) return false;
	return isInside(cwd, filePath) && !hasTrackedMatch(cwd, filePath, git.tracked);
}

export function evaluateCommandPolicy(command: string, cwd: string, options: PolicyOptions = {}): PolicyDecision {
	const profile = options.profile ?? "balanced";
	const normalized = normalizeCommand(command);

	if (hasUnescapedNewline(command)) return { action: "review", reason: "multiple shell commands separated by newline" };
	if (INPUT_REDIRECT_PATTERN.test(command)) return { action: "review", reason: "shell input redirection or process substitution" };
	if (/\$\(|<\(/.test(command)) return { action: "review", reason: "shell substitution" };
	if (/\$\{?[A-Za-z_][A-Za-z0-9_]*\}?/.test(command)) return { action: "review", reason: "environment variable expansion" };

	for (const { pattern, label } of CLOUD_MUTATION_PATTERNS) {
		if (pattern.test(normalized)) return { action: "review", reason: label };
	}
	for (const { pattern, label } of SENSITIVE_COMMAND_PATTERNS) {
		if (pattern.test(normalized)) return { action: "review", reason: label };
	}

	const pathArgs = extractPathArgs(normalized);
	if (pathArgs.some(hasShellExpansion)) return { action: "review", reason: "shell-expanded path target" };

	const resolvedPaths = pathArgs.map((arg) => resolveCommandPath(arg, cwd));

	for (const filePath of resolvedPaths) {
		const reason = sensitivePathReason(filePath, cwd);
		if (reason) return { action: "review", reason };
		if (!isInside(cwd, filePath) && !isInTmp(filePath)) {
			return { action: "review", reason: `path outside current working directory: ${filePath}` };
		}
	}

	if (MUTATION_COMMAND_PATTERN.test(normalized) && resolvedPaths.length > 0) {
		if (profile === "strict" && !resolvedPaths.every(isInTmp)) {
			return { action: "review", reason: "strict profile requires approval for non-/tmp mutations" };
		}
		if (RECURSIVE_RM_PATTERN.test(normalized) && resolvedPaths.some((filePath) => filePath === cwd || isInside(filePath, cwd))) {
			return { action: "review", reason: "recursive delete of current working directory" };
		}
		const git = trackedPathsFor(cwd, resolvedPaths);
		if (resolvedPaths.every((filePath) => isFreelyMutablePath(cwd, filePath, git))) {
			return { action: "allow", reason: "mutation is limited to /tmp or files not tracked by git" };
		}
	}

	return { action: "none" };
}
