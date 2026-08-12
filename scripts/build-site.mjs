import { cp, lstat, mkdir, rm } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const output = resolve(root, "_site");
const publicPaths = [
  "404.html", "CNAME", "CHANGELOG.md", "LICENSE", "NOTICE", "README.md",
  "SECURITY.md", "VERSION", "contact.html", "continuity-evidence.js",
  "favicon.ico", "index.html", "policy-roundtrip.js", "privacy.html",
  "robots.txt", "simulator-bootstrap.js", "simulator-fallback.js",
  "simulator-world.js", "simulator.css", "simulator.html", "simulator.js",
  "site.js", "sitemap.xml", "staging-feed.js", "styles.css", "terms.html",
  "assets", "data", "guides", "images", "release", "schemas", "vendor"
];

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

for (const relativePath of publicPaths) {
  const source = resolve(root, relativePath);
  if (!source.startsWith(`${root}${sep}`)) throw new Error(`Unsafe public path: ${relativePath}`);
  const info = await lstat(source);
  if (info.isSymbolicLink()) throw new Error(`Public path may not be a symlink: ${relativePath}`);
  await cp(source, resolve(output, relativePath), { recursive: true, errorOnExist: true });
}

console.log(`Built ${publicPaths.length} allowlisted paths in _site/`);
