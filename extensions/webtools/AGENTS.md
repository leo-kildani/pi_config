# Webtools Extension Agent Guide

## Project Overview

The webtools extension registers `web_search` and `web_fetch`. It uses TypeScript, Node.js 22, and the Exa and Parallel APIs. The root `AGENTS.md` has shared repository rules. The closest `AGENTS.md` takes precedence.

## Commands

Run these commands from the repository root.

- Install dependencies: `pnpm install`
- Type-check all extensions: `pnpm typecheck`
- Test all extensions: `pnpm test`
- Test webtools credentials: `node --experimental-strip-types --test extensions/webtools/credentials.test.ts`
- Check webtools behavior: `pnpm check:webtools`

The root `package.json` defines these scripts. It does not define a formatter, linter, or build command.

## Testing

- Keep webtools tests in `extensions/webtools/` beside the code they test.
- Name tests with the `.test.ts` suffix.
- Do not make network requests in credential tests.
- Restore `env.json` and process environment variables after tests that change them.
- Run the focused test, `pnpm typecheck`, `pnpm test`, and `pnpm check:webtools` after code changes.

## Code Style

- Use TypeScript with ESM.
- Import runtime modules with the `.ts` extension in new code.
- Use the existing `ctx.ui` dialogs for provider selection and key input.
- Keep `process.env` values ahead of `env.json` values in credential lookup.

```ts
// ✅ Save the trimmed key without showing it.
setProviderApiKey(provider, trimmedKey);

// ❌ Do not expose a key in a notification.
ctx.ui.notify(trimmedKey);
```

## Boundaries

- ✅ **Always:** add or update tests for behavior changes. Keep provider keys out of logs and notifications.
- ⚠️ **Ask first:** add a dependency, change a public tool name, or change `package.json` extension registration.
- 🚫 **Never:** commit `env.json` or API keys. Do not edit `node_modules/` or commit generated files.

## Git Workflow

- Keep one logical change per commit.
- Use a one-line commit message that names the extension, such as `webtools: add config command`.
- Run the verification commands above before a commit.

## Project Structure

- `index.ts` registers the webtools tools and slash command.
- `credentials.ts` reads credentials and writes provider keys to `env.json`.
- `exa.ts` and `parallel.ts` call the provider APIs.
- `types.ts` contains shared request, response, and formatting logic.
- `check.ts` runs the webtools behavior check without network access.
- `env.json.example` shows the supported provider fields.
- `.gitignore` excludes `env.json` and `node_modules/`.

## Notes

The `env.json` file contains secrets. Keep it local. Environment variables override values in that file.
