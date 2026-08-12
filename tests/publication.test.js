import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, readFile, rm } from "node:fs/promises";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = new URL("../", import.meta.url);

test("publication artifact contains only the supported public surface", async () => {
  await rm(new URL("_site", root), { recursive: true, force: true });
  await execFileAsync(process.execPath, ["scripts/build-site.mjs"], { cwd: root });

  for (const path of ["index.html", "simulator.html", "SECURITY.md", "data/bounder-receipts.v1.json", "vendor/three/LICENSE"]) {
    await access(new URL(`_site/${path}`, root));
  }
  for (const path of ["docs", "tmp", "tests", "scripts", "package.json", ".github"]) {
    await assert.rejects(access(new URL(`_site/${path}`, root)), `${path} leaked into the public artifact`);
  }

  const security = await readFile(new URL("_site/SECURITY.md", root), "utf8");
  assert.doesNotMatch(security, /docs\/(?:THREAT_MODEL|LEGACY_STATUS)\.md/);
});
