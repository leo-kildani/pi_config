# pi config

A personal pi package. It contains skills and extensions.

## Install for usage

Install the package from the git repository:

```bash
pi install git:github.com/leo-kildani/pi_config
```

Pi loads two resource sets from the root `package.json`:

- `skills/` — reusable skill instructions.
- `extensions/` — autocompact, plan, subagent, todowrite, and webtools.

The webtools extension needs API keys. Copy `extensions/webtools/env.json.example` to `extensions/webtools/env.json`. Set the `exa` and `parallel` keys in that file. You can also set `EXA_API_KEY` and `PARALLEL_API_KEY` in the process environment.

## Install the external packages

The file `packages.txt` lists the external pi packages. Install each entry:

```bash
while read -r pkg; do pi install "$pkg"; done < packages.txt
```

## Develop

Clone the repository for development:

```bash
git clone git@github-personal:leo-kildani/pi_config.git
cd pi_config
pnpm install
```

Run the tools:

```bash
pnpm typecheck   # tsc -p tsconfig.json
pnpm test        # node --experimental-strip-types --test "extensions/*/*.test.ts"
```

Each extension is a directory in `extensions/`. Each directory has an `index.ts` entry point. The root `package.json` lists each entry point in `pi.extensions`.

Add a runtime dependency to the root `dependencies` in `package.json`. Then run `pnpm install`.
