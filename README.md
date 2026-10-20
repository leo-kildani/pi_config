# pi config

A personal pi package. It contains skills and extensions.

## Install for usage

Install the package from the git repository:

```bash
pi install git:github.com/leo-kildani/pi_config
```

Pi loads two resource sets from the root `package.json`:

- `skills/` — reusable skill instructions.
- `extensions/` — plan, safe-subagents, todowrite, and webtools.

The file `packages.txt` lists external pi packages.

The webtools extension needs API keys. Copy `extensions/webtools/env.json.example` to `extensions/webtools/env.json`. Set the `exa` and `parallel` keys in that file. You can also set `EXA_API_KEY` and `PARALLEL_API_KEY` in the process environment.

## Install the external packages

The file `packages.txt` lists the external pi packages. Install each entry:

```bash
while read -r pkg; do pi install "$pkg"; done < packages.txt
```

## Docker harness

The Docker image runs as the unprivileged `node` user with UID and GID 1000. The user's home directory is `/home/node`. Pi stores its agent configuration, sessions, and state in `/home/node/.pi/agent`.

The Docker script mounts the named volume `pi-global-config-data` at `/home/node/.pi/agent`. This volume preserves agent configuration, sessions, and state between container runs.

From the repository root, enter the `docker/` directory and run the Docker script:

```bash
cd docker
./run-pi-harness-docker.sh
```

Apple container users must use `./run-pi-harness-apple-container.sh` instead.

The Docker script removes any existing container named `pi-coding-agent-container` with `docker rm -f`. This removes running, stopped, and paused containers. The script then starts a fresh container with `--rm`. Docker removes that container when it exits.

Without arguments, the Docker script mounts no project directories. The container has an empty `/workspace` directory. Pass one or more project directories to mount each project at `/workspace/<dir-name>`:

```bash
./run-pi-harness-docker.sh ~/path/to/projectA ~/path/to/projectB
```

The script mounts these directories as `/workspace/projectA` and `/workspace/projectB`.

### Hide sensitive project files

Place a `.guard` file in the root of each project that needs file masking. Add one `find -name` pattern per line. The patterns use standard basename matching, and match files by name anywhere in the project tree. For example, `.env` matches a root or nested `.env` file.

```text
.env
.env.*
*.pem
*.key
*.secrets
credentials.json
```

The Docker script finds matching files and bind-mounts `/dev/null` over each file in read-only mode (`:ro`). Reads return 0 bytes. Writes fail with `Read-only file system`. The script also masks `.guard` itself, so the agent cannot inspect the blocklist.

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
