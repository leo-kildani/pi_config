import path from "node:path";

export interface CommandClassification {
	readOnly: boolean;
	readsSecrets: boolean;
	writesData: boolean;
	destroysData: boolean;
	secretReason?: string;
	effectReason?: string;
}

export function normalizeCommand(command: string): string {
	return command.trim().replace(/\\\n\s*/g, "").replace(/\n\s*/g, " ");
}

const MUTATION_COMMAND_PATTERN = /^\s*(rm|mv|cp|mkdir|touch|truncate|ln|chmod|chown|install)\b/i;

const SENSITIVE_PATH_PARTS = new Set([
	".aws", ".azure", ".config/gcloud", ".docker/config.json", ".git", ".gnupg", ".hg", ".kube",
	".netrc", ".npmrc", ".pypirc", ".ssh", ".svn",
]);
const SENSITIVE_BASENAMES = new Set([
	".env", ".env.local", ".env.production", ".envrc", "credentials", "credentials.json",
	"id_rsa", "id_dsa", "id_ecdsa", "id_ed25519", "known_hosts", "package-lock.json",
	"pnpm-lock.yaml", "service-account.json", "terraform.tfvars", "yarn.lock",
]);
const SENSITIVE_EXTENSIONS = new Set([".key", ".pem", ".p12", ".pfx"]);

function isLikelyPathArg(arg: string): boolean {
	if (!arg || arg === "--" || arg.startsWith("-")) return false;
	if (/^(https?:|git@|ssh:)/i.test(arg)) return false;
	if (/^[^:]+:(.+)$/.test(arg)) return true;
	if (/^(~|\.|\.\.|\/)(\/|$)/.test(arg)) return true;
	if (arg.includes("/")) return true;
	if (SENSITIVE_BASENAMES.has(path.basename(arg)) || SENSITIVE_EXTENSIONS.has(path.extname(arg))) return true;
	return false;
}

export function extractPathArgs(command: string): string[] {
	const normalized = normalizeCommand(command);
	const words = wordsOf(normalized) ?? [];
	const positional = words.slice(1).filter((arg) => arg !== "--" && !arg.startsWith("-") && !/^(https?:|git@|ssh:)/i.test(arg));
	if (MUTATION_COMMAND_PATTERN.test(normalized)) return positional;
	return positional.filter(isLikelyPathArg);
}

function wordsOf(command: string): string[] | null {
	const words: string[] = [];
	let word = "";
	let quote: "'" | '"' | null = null;
	let started = false;

	for (const char of command) {
		if (quote) {
			if (char === quote) quote = null;
			else word += char;
			started = true;
			continue;
		}
		if (char === "'" || char === '"') {
			quote = char;
			started = true;
		} else if (/\s/.test(char)) {
			if (started) words.push(word);
			word = "";
			started = false;
		} else {
			word += char;
			started = true;
		}
	}
	if (quote) return null;
	if (started) words.push(word);
	return words;
}

const SAFE_LS_OPTIONS = new Set(["--all", "--almost-all", "--directory", "--human-readable", "--long", "--recursive", "--size"]);
const SAFE_GREP_OPTIONS = new Set([
	"--basic-regexp", "--extended-regexp", "--fixed-strings", "--ignore-case", "--line-number",
	"--recursive", "--files-with-matches", "--files-without-match", "--no-messages", "--word-regexp",
]);

function hasUnsafeSyntax(command: string): boolean {
	let quote: "'" | '"' | null = null;
	for (let i = 0; i < command.length; i++) {
		const char = command[i]!;
		if (char === "\n" || char === "\r" || char === "`") return true;
		if (char === "$" && command[i + 1] === "(") return true;
		if (char === "<" && command[i + 1] === "(") return true;
		if (quote) {
			if (char === quote) quote = null;
			continue;
		}
		if (char === "'" || char === '"') {
			quote = char;
			continue;
		}
		if (char === "\\" || char === ">" || char === ";" || char === "|" || char === "&") return true;
	}
	return quote !== null;
}

function isSafeRead(command: string): boolean {
	const words = wordsOf(command);
	if (!words?.length) return false;
	const [name, ...args] = words;
	if (name === "echo" || name === "printf") return true;
	if (name === "pwd" || name === "cat" || name === "file" || name === "stat" || name === "wc" || name === "readlink") {
		return !args.some((arg) => arg.startsWith("-") && arg !== "-");
	}
	if (name === "ls") {
		return args.every((arg) => !arg.startsWith("-") || arg === "-" || (/^-[aAbBcCdEfFghHiIlLmNopQrRsStTuUvwx1]+$/.test(arg)) || SAFE_LS_OPTIONS.has(arg));
	}
	if (name === "head" || name === "tail") {
		for (let i = 0; i < args.length; i++) {
			const arg = args[i]!;
			if (arg === "-n" || arg === "-c" || arg === "--lines" || arg === "--bytes") {
				if (!args[++i] || !/^\d+$/.test(args[i]!)) return false;
			} else if (arg.startsWith("-") && arg !== "-" && !/^-[qv]+$/.test(arg) && !/^-(n|c)\d+$/.test(arg)) {
				return false;
			}
		}
		return true;
	}
	if (name === "grep") {
		return args.every((arg) => !arg.startsWith("-") || arg === "-" || SAFE_GREP_OPTIONS.has(arg) || /^-[EinivwxlLhcqso]+$/.test(arg));
	}
	if (name === "find") {
		return args.length <= 1;
	}
	if (name === "git") return safeGit(words);
	if (name === "curl") return safeCurl(words);
	return false;
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

export function resolveCommandPath(arg: string, cwd: string): string {
	const match = /^[^:]+:(.+)$/.exec(arg);
	const target = match?.[1] ?? arg;
	const expanded = target === "~" || target.startsWith("~/") ? path.join(process.env.HOME ?? "", target.slice(1)) : target;
	return path.resolve(cwd, expanded);
}

export function isInside(parent: string, child: string): boolean {
	const rel = path.relative(parent, child);
	return rel === "" || (!!rel && !rel.startsWith("..") && !path.isAbsolute(rel));
}

export function isInTmp(filePath: string): boolean {
	return isInside(path.resolve("/tmp"), filePath) || isInside(path.resolve("/private/tmp"), filePath);
}

function broadDeleteReason(command: string, cwd: string): string | null {
	if (!/^\s*rm\s+-[^\s]*r/i.test(command)) return null;
	const words = wordsOf(command) ?? [];
	for (const arg of words.slice(1)) {
		if (arg.startsWith("-")) continue;
		if (["/", "~", "$HOME", "${HOME}", "$PWD", "${PWD}"].includes(arg)) return "recursive force delete of a broad path";
		const resolved = resolveCommandPath(arg, cwd);
		if (resolved === cwd || isInside(resolved, cwd)) return "recursive delete of current working directory";
	}
	return null;
}

function commandReadsSecrets(command: string, cwd: string, skipPathSecrets = false): boolean {
	if (disclosesSecretEnv(command)) return true;
	if (isEnvDisclosure(command)) return true;
	if (skipPathSecrets) return false;
	return extractPathArgs(command).some((arg) => sensitivePathReason(resolveCommandPath(arg, cwd), cwd) !== null);
}

const SECRET_ENV_NAME = /(SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL|API[_-]?KEY|PRIVATE[_-]?KEY|ACCESS[_-]?KEY|AWS_|GITHUB|NPM_|OPENAI|ANTHROPIC)/i;
const WRITE_COMMAND_PATTERN = /^\s*(mv|cp|mkdir|touch|ln|chmod|chown|install|tee|patch|rsync|scp)\b/i;
const DESTROY_COMMAND_PATTERN = /^\s*(rm|shred|wipefs|mkfs(?:\.\w+)?|dd|truncate)\b/i;
const GIT_WRITE_PATTERN = /^\s*git\s+(add|commit|push|pull|fetch|reset|checkout|switch|restore|clean|rm|mv|stash|merge|rebase|cherry-pick|revert|tag)\b/i;
const PACKAGE_WRITE_PATTERN = /^\s*(npm|pnpm|yarn|bun|pip|pip3|poetry|cargo|go)\s+(install|add|remove|uninstall|update|upgrade|publish|ci)\b/i;
const SED_INPLACE_PATTERN = /\bsed\s+(-[^\s]*i|--in-place)/i;

export interface CommandEffect {
	writesData: boolean;
	destroysData: boolean;
	reason: string;
}

const CLOUD_EFFECTS: Array<{ pattern: RegExp; effect: CommandEffect }> = [
	{ pattern: /^\s*(terraform|terragrunt)\s+.*\b(destroy|state\s+(rm|mv))\b/i, effect: { writesData: false, destroysData: true, reason: "Terraform/Terragrunt state or resource mutation" } },
	{ pattern: /^\s*(terraform|terragrunt)\s+.*\b(apply|import|state\s+push|taint|untaint|force-unlock)\b/i, effect: { writesData: true, destroysData: false, reason: "Terraform/Terragrunt state or resource mutation" } },
	{ pattern: /^\s*gcloud\s+.*\bdelete\b/i, effect: { writesData: false, destroysData: true, reason: "gcloud cloud-resource or credential mutation" } },
	{ pattern: /^\s*gcloud\s+.*\b(create|update|deploy|enable|disable|set-iam-policy|add-iam-policy-binding|remove-iam-policy-binding|set|unset|auth\s+(login|activate-service-account))\b/i, effect: { writesData: true, destroysData: false, reason: "gcloud cloud-resource or credential mutation" } },
	{ pattern: /^\s*(aws|aws-vault)\s+.*\b(delete|remove|terminate|revoke|detach|rm)\b/i, effect: { writesData: false, destroysData: true, reason: "AWS cloud-resource mutation" } },
	{ pattern: /^\s*(aws|aws-vault)\s+.*\b(create|put|update|attach|authorize|start|stop|modify|run-instances|deploy|sync|cp|mv)\b/i, effect: { writesData: true, destroysData: false, reason: "AWS cloud-resource mutation" } },
	{ pattern: /^\s*(gsutil|bq)\s+.*\b(rm|delete)\b/i, effect: { writesData: false, destroysData: true, reason: "GCP data/resource mutation" } },
	{ pattern: /^\s*(gsutil|bq)\s+.*\b(cp|mv|setmeta|ch|mk|update|load|query)\b/i, effect: { writesData: true, destroysData: false, reason: "GCP data/resource mutation" } },
	{ pattern: /^\s*kubectl\s+.*\bdelete\b/i, effect: { writesData: false, destroysData: true, reason: "Kubernetes cluster mutation" } },
	{ pattern: /^\s*kubectl\s+.*\b(apply|patch|create|replace|scale|rollout|cordon|drain|taint|annotate|label|exec)\b/i, effect: { writesData: true, destroysData: false, reason: "Kubernetes cluster mutation" } },
];

const SENSITIVE_EFFECTS: Array<{ pattern: RegExp; effect: CommandEffect }> = [
	{ pattern: /^\s*(sudo|su)\b/i, effect: { writesData: true, destroysData: false, reason: "privilege escalation" } },
	{ pattern: /curl\b.*\|\s*(sh|bash)|wget\b.*\|\s*(sh|bash)/i, effect: { writesData: true, destroysData: false, reason: "remote script execution" } },
	{ pattern: /\bchmod\s+(-[^\s]*\s+)?777\b/i, effect: { writesData: true, destroysData: false, reason: "world-writable permissions" } },
];

const EFFECTS = [...CLOUD_EFFECTS, ...SENSITIVE_EFFECTS];

export interface DetectedCommandEffect extends CommandEffect {
	index: number;
}

export function detectSensitiveEffect(command: string): DetectedCommandEffect | undefined {
	for (const { pattern, effect } of SENSITIVE_EFFECTS) {
		const match = pattern.exec(command);
		if (match) return { ...effect, index: match.index };
	}
	return undefined;
}

function specificEffect(command: string): CommandEffect | undefined {
	for (const { pattern, effect } of EFFECTS) {
		if (pattern.test(command)) return effect;
	}
	return undefined;
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

function isWriteCommand(command: string): boolean {
	return WRITE_COMMAND_PATTERN.test(command) || GIT_WRITE_PATTERN.test(command) || PACKAGE_WRITE_PATTERN.test(command) || SED_INPLACE_PATTERN.test(command) || hasOutputRedirect(command);
}

function disclosesSecretEnv(command: string): boolean {
	const pattern = /\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g;
	let match: RegExpExecArray | null;
	while ((match = pattern.exec(command)) !== null) {
		if (SECRET_ENV_NAME.test(match[1]!)) return true;
	}
	return false;
}

function isEnvDisclosure(command: string): boolean {
	const words = wordsOf(command);
	if (!words?.length) return false;
	const name = path.basename(words[0]!);
	if (name === "env" || name === "set") return true;
	if (/\bprintenv\b/.test(command)) return true;
	return name === "jq" && words.includes("env");
}

const SAFE_GIT_COMMANDS = new Set(["status", "diff", "log", "show", "rev-parse", "ls-files", "cat-file"]);
const SAFE_GIT_OPTIONS = new Set([
	"--", "--short", "--branch", "--porcelain", "--stat", "--name-only", "--name-status",
	"--cached", "--staged", "--check", "--oneline", "--graph", "--decorate", "--all",
	"--no-ext-diff", "--no-textconv", "--untracked-files=no", "--ignored",
]);
const SAFE_CURL_OPTIONS = new Set([
	"-s", "-S", "-L", "-I", "-i", "-v", "-f", "--silent", "--show-error", "--location",
	"--head", "--include", "--fail",
]);

function safeGit(words: string[]): boolean {
	const command = words[1];
	if (!command || !SAFE_GIT_COMMANDS.has(command)) return false;
	return words.slice(2).every((word) => !word.startsWith("-") || SAFE_GIT_OPTIONS.has(word));
}

function safeCurl(words: string[]): boolean {
	if (words[1] !== "-q" && words[1] !== "--disable") return false;
	let sawUrl = false;
	for (let i = 2; i < words.length; i++) {
		const word = words[i]!;
		if (word === "-X" || word === "--request") {
			if (words[++i]?.toUpperCase() !== "GET") return false;
		} else if (SAFE_CURL_OPTIONS.has(word)) {
			continue;
		} else if (/^https?:\/\//i.test(word)) {
			sawUrl = true;
		} else {
			return false;
		}
	}
	return sawUrl;
}

export function classifyCommand(command: string, cwd: string): CommandClassification {
	const specific = specificEffect(command);
	const writesData = specific?.writesData === true || isWriteCommand(command);
	const destroysData = specific?.destroysData === true || DESTROY_COMMAND_PATTERN.test(command);
	const hasEffect = writesData || destroysData;
	const secretPathReason = hasEffect ? extractPathArgs(command).map((arg) => sensitivePathReason(resolveCommandPath(arg, cwd), cwd)).find((reason) => reason !== null) : undefined;
	const broadReason = hasEffect ? broadDeleteReason(command, cwd) : null;
	const readsSecrets = commandReadsSecrets(command, cwd, hasEffect);
	return {
		readOnly: !readsSecrets && !hasEffect && !hasUnsafeSyntax(command) && isSafeRead(command),
		readsSecrets,
		writesData,
		destroysData,
		...(readsSecrets ? { secretReason: "command reads a secret" } : {}),
		...(hasEffect ? { effectReason: secretPathReason ?? broadReason ?? specific?.reason ?? "write or destructive command" } : {}),
	};
}
