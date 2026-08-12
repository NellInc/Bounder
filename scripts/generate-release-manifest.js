import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";

const version = (await readFile("VERSION", "utf8")).trim();
const manifests = (await readdir("release"))
  .map((name) => ({ name, match: name.match(/^bounder-reference-v(\d+)\.(\d+)\.(\d+)\.manifest\.json$/) }))
  .filter(({ match, name }) => match && name !== `bounder-reference-v${version}.manifest.json`)
  .sort((a, b) => {
    for (let index = 1; index <= 3; index += 1) {
      const difference = Number(b.match[index]) - Number(a.match[index]);
      if (difference) return difference;
    }
    return 0;
  });

if (!manifests.length) throw new Error("No prior release manifest is available as a file-list baseline");
const previous = JSON.parse(await readFile(`release/${manifests[0].name}`, "utf8"));
const files = [];

for (const { path } of previous.files) {
  const bytes = await readFile(path);
  files.push({
    path,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex")
  });
}

const manifest = {
  version,
  license: "Apache-2.0",
  generated_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  canonical_interlock: previous.canonical_interlock,
  files
};

const target = `release/bounder-reference-v${version}.manifest.json`;
await writeFile(target, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
console.log(`Wrote ${target} with ${files.length} pinned files`);
