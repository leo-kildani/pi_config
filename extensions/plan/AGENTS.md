# AGENTS.md

This file holds instructions for `extensions/plan`. The root `AGENTS.md` holds the package rules. The closest `AGENTS.md` wins.

## Overview

This extension runs a plan workflow. It registers one command, `/plan`. The command has three forms:

| Form | Action |
| --- | --- |
| `/plan <objective>` | Create a plan when no plan is set. Edit the pending plan when one is pending. Start a new plan when the current plan is built. |
| `/plan build` | Execute the pending plan. |
| `/plan show` | Toggle the Current Plan widget. |

A plan has two states: `pending` and `built`. A build run flips the state to `built` at `agent_end`.

The extension keeps one current plan for each session. The session id is part of the plan file name, so two sessions do not collide.

## Commands

Run these commands from the repository root.

| Task | Command |
| --- | --- |
| Type check | `pnpm typecheck` |
| All tests | `pnpm test` |
| Tests for this extension | `node --experimental-strip-types --test extensions/plan/logic.test.ts` |

## Testing

- Test files live next to the code. The name pattern is `<module>.test.ts`.
- `logic.ts` is pure. Test it with the Node test runner.
- `index.ts` needs a live session and a live terminal. Test it by hand.
- Add a test for each behavior change in `logic.ts`.
- Run `pnpm typecheck` and `pnpm test` before a commit.

A hand test starts `pi` with this repository as the working directory. Then run `/plan <objective>`, inspect the plan file, run `/plan build`, and run `/plan show`.

## Structure

- `index.ts` — the command, the widget, and the `agent_end` hook.
- `logic.ts` — the pure helpers: plan name, action choice, and agent prompts.
- `logic.test.ts` — the tests for `logic.ts`.

## Behavior rules

Keep these properties. They are the purpose of the extension.

- Plan states are only `pending` and `built`.
- One pending plan exists for each session.
- `/plan build` does nothing when no plan is set.
- `/plan build` reports `Current Plan Built` when the current plan is built.
- The state flips to `built` at `agent_end`. The `building` flag guards the flip.
- A built plan stays current until a new plan is created.
- The plan name is the first three non-filler words plus the session id. Example: `build-plan-extension-01a12d01.md`.
- A name collision adds a `-2`, `-3`, or later suffix.
- Plan files live in `~/.pi/agent/plans`.
- The model writes the plan file. The extension fixes the path first.
- State lives in the `plan-state` session entry. A fork or a resume rebuilds the state from the branch.
- `/plan show` is pure UI. It works while the agent is busy.
- The other forms need an idle session. They refuse a busy session.

## Code style

- Use TypeScript with ESM. Import a runtime file with the `.ts` extension.
- Keep `logic.ts` free of Pi imports and file system access. This rule keeps the tests fast.
- Use the imperative mood in each agent prompt.
- Use `skill:writing-in-ste` in the prompt text for the plan.

## Boundaries

- ✅ **Always:** run `pnpm typecheck` and `pnpm test` before a commit. Add a test for a logic change.
- ⚠️ **Ask first:** change the command name `/plan`, change a plan state name, or change the state storage.
- 🚫 **Never:** commit a plan file, a `*.logs` file, or `node_modules/`.

## Git workflow

- Keep one logical change per commit.
- Use a one-line commit message that names the extension, such as `plan: fix name synthesis`.
- Run the verification commands before a commit.

## Notes

The old `plan` extension used a classifier, a write guard, and a verification gate. This extension does not. Do not add them back without a request.
