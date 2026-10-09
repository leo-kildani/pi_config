import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

const extensionDir = dirname(fileURLToPath(import.meta.url));

// No override: a placeholder line in .env must not blank a real key
// already exported in the environment (e.g., by pi's own setup).
config({ path: join(extensionDir, ".env") });

export function loadCredentials() {
  return {
    exaApiKey: process.env.EXA_API_KEY?.trim() || undefined,
    parallelApiKey: process.env.PARALLEL_API_KEY?.trim() || undefined,
  };
}

export function assertProviderAvailable(
  provider: "exa" | "parallel",
): string {
  const credentials = loadCredentials();

  if (provider === "exa") {
    if (credentials.exaApiKey) return credentials.exaApiKey;
    throw new Error(
      "EXA_API_KEY is not set. Add it to ~/.pi/agent/extensions/webtools/.env (see .env.example). Get a key at https://dashboard.exa.ai/api-keys",
    );
  }

  if (credentials.parallelApiKey) return credentials.parallelApiKey;
  throw new Error(
    "PARALLEL_API_KEY is not set. Add it to ~/.pi/agent/extensions/webtools/.env (see .env.example). Get a key at https://platform.parallel.ai",
  );
}
