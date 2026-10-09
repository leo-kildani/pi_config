# AGENTS.md

## Overview

This repository is one pi package. It contains skills in `skills/` and extensions in `extensions/`. The root `package.json` declares both resource sets under the `pi` key. Node 22 and pnpm 11 execute the tooling.

## Setup and commands

- Install dependencies: `pnpm install`
- Type-check all files: `pnpm typecheck` (`tsc -p tsconfig.json`)
- Test all files: `pnpm test` (`node --experimental-strip-types --test "extensions/*/*.test.ts"`)
- Test one file: `node --experimental-strip-types --test extensions/todowrite/resolve.test.ts`
- Check webtools: `pnpm check:webtools`

## Testing

- Test files live next to the code in `extensions/<name>/`.
- Name a test file `<module>.test.ts`.
- Add or update a test for each behavior change.

## Code style

- Use TypeScript with ESM. The package sets `"type": "module"`.
- Import a runtime file with the `.ts` extension.

## Boundaries

- ✅ **Always:** run `pnpm typecheck` and `pnpm test` before a commit.
- ⚠️ **Ask first:** add a dependency, change `pi.extensions` in `package.json`, or change a public tool name.
- 🚫 **Never:** commit `node_modules/`, an `.env` file, or a `*.logs` file. Keep runtime dependencies in the root `package.json`, not in an extension directory.

## External packages

- `packages.txt` lists the external pi packages. It mirrors the `packages` array in `~/.pi/agent/settings.json`.
- Update `packages.txt` when you add or remove a package. Copy each entry from the `packages` array, one entry per line.
- Install every entry with `while read -r pkg; do pi install "$pkg"; done < packages.txt`.

## Project structure

- `package.json` — the pi manifest. It lists `pi.skills` and `pi.extensions`.
- `packages.txt` — the external pi packages from `settings.json`. One source per line.
- `skills/` — skill packages. Each has a `SKILL.md`.
- `extensions/` — five extensions. Each has an `index.ts` entry point.
- `tsconfig.json` — one type-check config for all extensions.

## Git workflow

- Keep one logical change per commit.
- Use a one-line message that names the extension, for example `todowrite: fix id resolution`.

## Notes

- `pnpm-workspace.yaml` holds the build allowlist only. This package has no workspace members.
- `package.json` declares this repository. `packages.txt` declares the external packages.
- The closest `AGENTS.md` to a file wins.
