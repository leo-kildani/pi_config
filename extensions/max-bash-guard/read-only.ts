export type ReadOnlyDecision = { action: "allow" } | { action: "block"; reason: string };

const SAFE_GIT_COMMANDS = new Set(["status", "diff", "log", "show", "rev-parse", "ls-files", "cat-file"]);
const SAFE_GIT_OPTIONS = new Set([
	"--", "--short", "--branch", "--porcelain", "--stat", "--name-only", "--name-status",
	"--cached", "--staged", "--check", "--oneline", "--graph", "--decorate", "--all",
	"--no-ext-diff", "--no-textconv", "--untracked-files=no", "--ignored",
]);
const SAFE_LS_OPTIONS = new Set(["--all", "--almost-all", "--directory", "--human-readable", "--long", "--recursive", "--size"]);
const SAFE_GREP_OPTIONS = new Set([
	"--basic-regexp", "--extended-regexp", "--fixed-strings", "--ignore-case", "--line-number",
	"--recursive", "--files-with-matches", "--files-without-match", "--no-messages", "--word-regexp",
]);
const SAFE_CURL_OPTIONS = new Set([
	"-s", "-S", "-L", "-I", "-i", "-v", "-f", "--silent", "--show-error", "--location",
	"--head", "--include", "--fail",
]);

function splitCommands(command: string): string[] | null {
	const commands: string[] = [];
	let current = "";
	let quote: "'" | '"' | null = null;

	for (let i = 0; i < command.length; i++) {
		const char = command[i]!;
		if (char === "\\" || char === "\n" || char === "\r" || char === "<" || char === ">" || char === "$" || char === "`") return null;
		if (quote) {
			if (char === quote) quote = null;
			current += char;
			continue;
		}
		if (char === "'" || char === '"') {
			quote = char;
			current += char;
			continue;
		}
		if ("*?[]{}~".includes(char)) return null;
		if (char === ";" || char === "|" || char === "&") {
			const next = command[i + 1];
			if (char === "&" && next !== "&") return null;
			if (char === "|" && next === "|") i++;
			else if (char === "&") i++;
			const segment = current.trim();
			if (!segment) return null;
			commands.push(segment);
			current = "";
			continue;
		}
		current += char;
	}
	if (quote) return null;
	const last = current.trim();
	if (!last) return null;
	commands.push(last);
	return commands;
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

function safeCommand(command: string): boolean {
	const words = wordsOf(command);
	if (!words?.length) return false;
	const [name, ...args] = words;

	if (name === "git") return safeGit(words);
	if (name === "curl") return safeCurl(words);
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
	return false;
}

export function evaluateReadOnlyCommand(command: string): ReadOnlyDecision {
	const commands = splitCommands(command);
	if (!commands || !commands.every(safeCommand)) {
		return { action: "block", reason: "command is not proven read-only" };
	}
	return { action: "allow" };
}
