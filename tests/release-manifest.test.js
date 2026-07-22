import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("current release manifest pins every published reference artifact", async () => {
  // The manifest under test tracks VERSION, so a release bump needs no test edit.
  const version = (await readFile(new URL("VERSION", root), "utf8")).trim();
  const manifest = JSON.parse(
    await readFile(new URL(`release/bounder-reference-v${version}.manifest.json`, root), "utf8")
  );
  assert.equal(manifest.version, version);
  assert.equal(manifest.license, "Apache-2.0");
  assert.match(manifest.canonical_interlock.commit, /^[0-9a-f]{40}$/);
  assert.equal(new Set(manifest.files.map(({ path }) => path)).size, manifest.files.length);
  assert.ok(manifest.files.length >= 25);

  for (const artifact of manifest.files) {
    const bytes = await readFile(new URL(artifact.path, root));
    assert.equal(bytes.length, artifact.bytes, `${artifact.path} byte count drifted`);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), artifact.sha256, `${artifact.path} hash drifted`);
  }
});
