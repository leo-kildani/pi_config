# Safe Subagents

Delegate tasks to specialized subagents with isolated context windows.

The `safe_subagents` tool keeps project-local agent definitions behind a scope
switch and a confirmation prompt, so a repository you do not trust cannot hand
its own prompt to a subprocess.

## Features

- **Isolated context**: Each subagent runs in a separate `pi` process
- **Skill isolation**: A subagent loads only the skills its definition names, and no others
- **Extension isolation**: A subagent loads only the extensions its definition names, and no others
- **Streaming output**: See tool calls and progress as they happen
- **Parallel streaming**: All parallel tasks stream updates simultaneously
- **Markdown rendering**: Final output rendered with proper formatting (expanded view)
- **Usage tracking**: Shows turns, tokens, cost, and context usage per agent
- **Abort support**: Ctrl+C propagates to kill subagent processes

## Structure

```
safe-subagents/
├── README.md            # This file
├── index.ts             # The extension (entry point)
├── agents.ts            # Agent discovery logic
├── agents/              # Sample agent definitions
│   ├── explorer.md      # Read-only recon and task scoping
│   └── code-reviewer.md # Read-only code review
```

## Installation

This extension is part of the `pi_config` package and is declared under
`pi.extensions` in the package `package.json`.

A package entry in `~/.pi/agent/settings.json` can narrow which extensions load.
If this one is not enabled, run `pi config`, or add the exact path to that
entry:

```json
{
  "source": "git:github.com/leo-kildani/pi_config",
  "extensions": ["+extensions/safe-subagents/index.ts"]
}
```

Add `-extensions/safe-subagents/index.ts` to turn it off again.

The sample agents are plain files. Symlink them so the extension can find them:

```bash
# Agents
mkdir -p ~/.pi/agent/agents
for f in extensions/safe-subagents/agents/*.md; do
  ln -sf "$(pwd)/$f" ~/.pi/agent/agents/$(basename "$f")
done
```

Run the loop from the repository root. The extension itself needs no symlink.

## Security Model

This tool executes a separate `pi` subprocess with a delegated system prompt and tool/model configuration.

**Project-local agents** (`.pi/agents/*.md`) are repo-controlled prompts that can instruct the model to read files, run bash commands, etc.

**Default behavior:** Only loads **user-level agents** from `~/.pi/agent/agents`.

The child process starts with `--no-skills` and then receives one `--skill` path per name in the agent's `skills` field. Skills are resolved by name against the parent session, so a subagent can load any skill the parent can see, including skills from installed packages. An agent without the field loads no skills.

The child also starts with `--no-extensions`. The parent resolves each extension selector against source metadata from loaded extension tools and commands, then passes the resolved path to the child as `--extension`. A selector must match one loaded extension. Unknown or ambiguous selectors fail before the child starts. Extensions that register no tools or commands need an explicit path.

Declare every extension-provided tool in the agent's `tools` field too. An extension tool is available only when its extension is listed and its tool name is allowed.

To enable project-local agents, pass `agentScope: "both"` (or `"project"`). Only do this for repositories you trust.

When running interactively, the tool prompts for confirmation before running project-local agents in untrusted projects. Trusted projects skip the additional prompt. Set `confirmProjectAgents: false` to disable confirmation.

## Usage

### Single agent
```
Use explorer to find all authentication code
```

### Parallel execution
```
Run explorer twice in parallel: one task finds models, the other finds providers
```

### Chained workflow
```
Use a chain: first have explorer find the read tool, then have code-reviewer review the relevant implementation
```

## Tool Modes

| Mode | Parameter | Description |
|------|-----------|-------------|
| Single | `{ agent, task }` | One agent, one task |
| Parallel | `{ tasks: [...] }` | Multiple agents run concurrently (max 8, 4 concurrent) |
| Chain | `{ chain: [...] }` | Sequential with `{previous}` placeholder |

## Output Display

**Collapsed view** (default):
- Status icon (✓/✗/⏳) and agent name
- Last 5-10 items (tool calls and text)
- Usage stats: `3 turns ↑input ↓output RcacheRead WcacheWrite $cost ctx:contextTokens model`

**Expanded view** (Ctrl+O):
- Full task text
- All tool calls with formatted arguments
- Final output rendered as Markdown
- Per-task usage (for chain/parallel)

**Parallel mode streaming**:
- Shows all tasks with live status (⏳ running, ✓ done, ✗ failed)
- Updates as each task makes progress
- Shows "2/3 done, 1 running" status
- Returns each completed task's final output to the parent model, capped at 50 KB per task
- Returns failure diagnostics from stderr/error messages when a child exits before producing output

**Tool call formatting** (mimics built-in tools):
- `$ command` for bash
- `read ~/path:1-10` for read
- `grep /pattern/ in ~/path` for grep
- etc.

## Agent Definitions

Agents are markdown files with YAML frontmatter:

```markdown
---
name: my-agent
description: What this agent does
tools: read, grep, find, ls, bash, my_extension_tool
skills: ponytail, writing-in-ste
extensions: "@example/pi-tools:src"
model: gpt-6-luna
thinking: low
---

System prompt for the agent goes here.
```

When `model` is omitted, the subagent inherits the dispatching session's active model and thinking level. Set `thinking` to override the thinking level for an agent, including when you set its model.

`skills` takes a comma separated list or a YAML array. Use the `name` field of the skill's frontmatter, not a path.

`extensions` takes a comma separated list or a YAML array of Pi-style package/resource selectors, such as `@ff-labs/pi-fff:src`. A selector uses the package name and the extension resource path shown by Pi. An explicit file path or `builtin:<name>` also works. A name selector resolves only when a loaded extension registers a tool or command. Tools registered by an extension must also appear by name in `tools`. Both fields are empty by default.

**Locations:**
- `~/.pi/agent/agents/*.md` - User-level (always loaded)
- `.pi/agents/*.md` - Project-level (only with `agentScope: "project"` or `"both"`)

Project agents override user agents with the same name when `agentScope: "both"`.

## Sample Agents

| Agent | Purpose | Model | Tools |
|-------|---------|-------|-------|
| `explorer` | Read-only codebase recon and task scoping | openrouter/openai/gpt-6-luna (low) | read, fffind, ffgrep, bash |
| `code-reviewer` | Read-only code review | openrouter/deepseek/deepseek-v4.1-flash (high) | read, fffind, ffgrep, bash |

`explorer` loads the `pi-fff` and `max-bash-guard` extensions. `code-reviewer` loads only its declared review skill and extensions.

## Error Handling

- **Exit code != 0**: Tool returns error with stderr/output
- **stopReason "error"**: LLM error propagated with error message
- **stopReason "aborted"**: User abort (Ctrl+C) kills subprocess, throws error
- **Chain mode**: Stops at first failing step, reports which step failed
- **Unknown skill**: The task fails before the subprocess starts and lists the available skill names

## Limitations

- Output truncated to last 10 items in collapsed view (expand to see all)
- Parallel model-visible output is capped at 50 KB per task; full results remain in tool details
- Agents discovered fresh on each invocation (allows editing mid-session)
- Parallel mode limited to 8 tasks, 4 concurrent
