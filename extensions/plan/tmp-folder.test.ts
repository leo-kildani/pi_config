import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "node:test";

describe("temporary directory lifecycle", () => {
	it("creates and removes a directory under /tmp", async () => {
		const directory = await mkdtemp(join("/tmp", "pi-temp-test-"));
		try {
			assert.equal((await stat(directory)).isDirectory(), true);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
		await assert.rejects(stat(directory), { code: "ENOENT" });
	});
});
