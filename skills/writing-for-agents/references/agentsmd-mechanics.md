# AGENTS.md Mechanics

Reference for the repository mechanics of an `AGENTS.md` file. Read this file when you write, audit, or improve an `AGENTS.md` file.

## Overview

An `AGENTS.md` is a README for agents. It gives a coding agent the commands, conventions, and limits that it needs. Keep the file separate from the human README.

`AGENTS.md` works across most coding agents (Claude Code, Cursor, Aider, Copilot, and Gemini CLI). Treat the file as tool-agnostic. Do not assume one agent brand.

## Before you write

Read the repository first. Do not ask the operator for a fact that the repository contains.

1. Read the manifest, build, and CI files. These files hold the real commands. Examples are `package.json`, `pyproject.toml`, `Cargo.toml`, `Makefile`, and `.github/workflows/`.
2. Copy each command from its source. Do not guess a plausible command.
3. Read the README for the project purpose and architecture.
4. Read an existing `AGENTS.md` in full. See "Editing an existing AGENTS.md".
5. Check for a monorepo. See "Monorepos".

Ask the operator only for information that the repository does not contain. A deploy target or a private policy is a good example.

## File content

- **Put runnable commands near the top.** Write `npm run test -- --watch=false`. Do not write "run the tests". Include the flags that the project uses. An agent reads this section often.
- **Show one real code snippet.** A short ✅/❌ pair from the real code beats a paragraph of description. Match the existing style. Do not describe a convention in the abstract.
- **State the limits.** Mark each action with one of three labels:
  - ✅ **Always:** write tests, run the linter.
  - ⚠️ **Ask first:** schema changes, new dependencies, CI config edits.
  - 🚫 **Never:** commit secrets, edit `vendor/` or `node_modules/`, force-push a shared branch, or delete a failing test.
- **Name the stack exactly.** Write "React 18 + TypeScript + Vite + Tailwind CSS." Do not write "a React project." Include a version when a version-specific quirk matters.
- **Cover six areas.** Cover commands, testing, project structure, code style, git and pull request workflow, and limits. A short file that covers all six beats a long file that covers two.

The limits and the secrets rule are the highest-value lines in the file. Do not omit them. Apply `skill:writing-for-agents` to the wording, the pruning, and the relevance of each line.

## Workflow

1. Inventory the repository. Use the steps in "Before you write".
2. Draft the file. Include the information that any agent needs.
3. Trim the file. Delete each line that does not change agent behavior.
4. Review the limits. Make sure the labels cover secrets, generated directories, and destructive actions.
5. Place the file. Use one `AGENTS.md` at the root of a single project. For several projects, see "Monorepos".
6. Verify each command. Compare each command with the manifest or the CI config. A wrong command is worse than no command, because the agent trusts it.

## Editing an existing AGENTS.md

1. Read the whole file first.
2. Keep each project-specific instruction. You may reword the surrounding text.
3. Delete a repeated rule, boilerplate text, and vague text.
4. Move the commands and the limits near the top. Do not restructure a working file without a reason.

Keep a strange-looking instruction. Example: "Never run migrations on the shared dev database." That instruction probably exists because something broke. Do not delete it during a cleanup.

## Monorepos

- Put a root `AGENTS.md` with the shared rules. Include organization lint rules, the git workflow, and the global limits.
- Give each subproject its own `AGENTS.md` with the package commands and the stack.
- State the precedence rule in the root file. The closest `AGENTS.md` wins. An agent in `packages/api/` uses `packages/api/AGENTS.md` over the root file.
- Do not repeat the precedence rule at length in a subproject file. One line that points to the root file is sufficient.

## Template

Use [templates/AGENTS-template.md](../templates/AGENTS-template.md) as a starting structure. Replace each placeholder with real project content. Delete each section that does not apply.
