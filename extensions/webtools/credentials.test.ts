import assert from "node:assert/strict";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { loadCredentials, setProviderApiKey } from "./credentials.ts";

const envJsonPath = join(dirname(fileURLToPath(import.meta.url)), "env.json");
const originalEnvJson = (() => {
  try {
    return readFileSync(envJsonPath, "utf8");
  } catch {
    return undefined;
  }
})();
const originalExaKey = process.env.EXA_API_KEY;
const originalParallelKey = process.env.PARALLEL_API_KEY;

after(() => {
  if (originalEnvJson === undefined) rmSync(envJsonPath, { force: true });
  else writeFileSync(envJsonPath, originalEnvJson);
  if (originalExaKey === undefined) delete process.env.EXA_API_KEY;
  else process.env.EXA_API_KEY = originalExaKey;
  if (originalParallelKey === undefined) delete process.env.PARALLEL_API_KEY;
  else process.env.PARALLEL_API_KEY = originalParallelKey;
});

test("setProviderApiKey updates one provider and preserves other JSON fields", () => {
  delete process.env.EXA_API_KEY;
  delete process.env.PARALLEL_API_KEY;
  writeFileSync(
    envJsonPath,
    JSON.stringify({ exa: "old-exa", parallel: "old-parallel", custom: "keep" }),
  );

  setProviderApiKey("exa", "new-exa");

  assert.deepStrictEqual(JSON.parse(readFileSync(envJsonPath, "utf8")), {
    exa: "new-exa",
    parallel: "old-parallel",
    custom: "keep",
  });
  assert.deepStrictEqual(loadCredentials(), {
    exaApiKey: "new-exa",
    parallelApiKey: "old-parallel",
  });

  process.env.EXA_API_KEY = "environment-exa";
  assert.strictEqual(loadCredentials().exaApiKey, "environment-exa");
});

test("setProviderApiKey rejects invalid JSON without replacing the file", () => {
  writeFileSync(envJsonPath, "{");

  assert.throws(() => setProviderApiKey("parallel", "new-parallel"), /not valid JSON/);
  assert.strictEqual(readFileSync(envJsonPath, "utf8"), "{");
});
