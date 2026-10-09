import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const envJsonPath = join(dirname(fileURLToPath(import.meta.url)), "env.json");

type EnvConfig = { exa?: string; parallel?: string };

function readEnvConfig(): EnvConfig {
  let text: string;
  try {
    text = readFileSync(envJsonPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(`${envJsonPath} is not valid JSON.`);
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${envJsonPath} must contain a JSON object.`);
  }

  const config = value as Record<string, unknown>;
  for (const provider of ["exa", "parallel"] as const) {
    if (config[provider] !== undefined && typeof config[provider] !== "string") {
      throw new Error(`${envJsonPath} field "${provider}" must be a string.`);
    }
  }
  return config as EnvConfig;
}

export function setProviderApiKey(
  provider: "exa" | "parallel",
  apiKey: string,
): void {
  const config = readEnvConfig();
  config[provider] = apiKey;
  writeFileSync(envJsonPath, `${JSON.stringify(config, null, 2)}\n`);
}

export function loadCredentials() {
  const config = readEnvConfig();
  return {
    exaApiKey: process.env.EXA_API_KEY?.trim() || config.exa?.trim() || undefined,
    parallelApiKey:
      process.env.PARALLEL_API_KEY?.trim() || config.parallel?.trim() || undefined,
  };
}

export function assertProviderAvailable(
  provider: "exa" | "parallel",
): string {
  const credentials = loadCredentials();

  if (provider === "exa") {
    if (credentials.exaApiKey) return credentials.exaApiKey;
    throw new Error(
      "EXA_API_KEY is not set. Set EXA_API_KEY or add the exa key to ~/.pi/agent/extensions/webtools/env.json. Get a key at https://dashboard.exa.ai/api-keys.",
    );
  }

  if (credentials.parallelApiKey) return credentials.parallelApiKey;
  throw new Error(
    "PARALLEL_API_KEY is not set. Set PARALLEL_API_KEY or add the parallel key to ~/.pi/agent/extensions/webtools/env.json. Get a key at https://platform.parallel.ai.",
  );
}
