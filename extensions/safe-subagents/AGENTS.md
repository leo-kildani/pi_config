# AGENTS.md

This file holds instructions for `extensions/safe-subagents`. The root `AGENTS.md` holds the package rules. The closest `AGENTS.md` wins.

## Overview

This extension registers one tool, `safe_subagents`. The tool starts a separate `pi` process for each task. Each subagent gets an isolated context window. The package `package.json` declares the extension under `pi.extensions`.

Agent definitions are markdown files. The tool reads them from `~/.pi/agent/agents/` and from `.pi/agents/`.

## Commands

Run these commands from the repository root.

| Task | Command |
| --- | --- |
| Type check | `pnpm typecheck` |
| All tests | `pnpm test` |
| Tests for this extension | `node --experimental-strip-types --test extensions/safe-subagents/agents.test.ts` |

## Testing

- Test files live next to the code. The name pattern is `<module>.test.ts`.
- `agents.ts` is pure logic. Test it with the Node test runner, with no subprocess.
- `index.ts` starts a real `pi` process. Test it manually, end to end.
- Add a test for each behavior change in `agents.ts`.

A manual end-to-end test needs three items: an agent file in `~/.pi/agent/agents/`, a dispatching session, and the project setting from "Local testing" below. Give the test agent a task that reports its tools and its skills.

## Structure

- `index.ts` — the tool: parameters, process spawn, streaming display, rendering.
- `agents.ts` — agent discovery, frontmatter parsing, skill-name resolution.
- `agents/*.md` — sample agent definitions.
- `prompts/*.md` — workflow prompt templates for `/implement`, `/scout-and-plan`, and `/implement-and-review`.

## Isolation rules

Keep these properties. They are the purpose of the extension.

- A subagent gets only the tools in its `tools:` field.
- A subagent gets only the skills in its `skills:` field. The child starts with `--no-skills`. Each resolved name becomes one `--skill <path>` flag.
- A subagent without a `skills:` field loads no skills.
- A subagent without a `model:` field inherits the parent model and thinking level.
- A skill name that the parent session cannot resolve fails the task before the spawn.
- Project agents load only with `agentScope: "project"` or `"both"`. An untrusted project also needs the confirmation prompt.

Do not add a code path that lets the child discover resources outside these fields.

### Skill visibility

Pi adds the `<available_skills>` block to the system prompt only when the child has `read` or `bash` in its tool list. See `system-prompt.js` in the pi package. An agent with a `skills:` field and no reader tool loads the skill, but the model never sees it. Give that agent `read`.

## Code style

- Use TypeScript with ESM. Import a runtime file with the `.ts` extension.
- Keep the frontmatter parser forgiving. One bad file must not remove the other agents. Accept a comma separated string and a YAML array. Return no names for any other type.

## Local testing

The project `.pi/settings.json` points at the working copy `extensions/safe-subagents/index.ts`. The same file excludes the installed package copy. Without the exclusion, pi loads the tool twice and stops with a name conflict.

That file is local to this machine. Do not commit it.

## Boundaries

- ✅ **Always:** run `pnpm typecheck` and `pnpm test` before a commit.
- ⚠️ **Ask first:** change the tool name `safe_subagents`, change a frontmatter key name, or relax a default (`agentScope: "user"`, `confirmProjectAgents: true`).
- 🚫 **Never:** weaken an isolation flag, commit `.pi/settings.json`, commit a `*.logs` file, or commit `node_modules/`.

## Sample agents

No sample agent declares `skills:`, so each one loads no skills. Add the key when a sample needs a skill.
