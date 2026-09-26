import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url));
const readText = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const pages = ["index.html", "simulator.html", "contact.html", "privacy.html", "terms.html", "404.html"];
const PNG_SIGNATURE = "89504e470d0a1a0a";

const pngSize = (bytes) => {
  assert.equal(bytes.subarray(0, 8).toString("hex"), PNG_SIGNATURE, "expected PNG bytes");
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
};

test("favicon.ico is a real multi-size ICO of the current mark, not a relabelled bitmap", async () => {
  const ico = await read("favicon.ico");
  assert.equal(ico.subarray(0, 4).toString("hex"), "00000100", "favicon.ico lacks the ICO header");
  const count = ico.readUInt16LE(4);
  const sizes = [];
  for (let index = 0; index < count; index += 1) {
    const entry = 6 + index * 16;
    const width = ico[entry] || 256;
    const length = ico.readUInt32LE(entry + 8);
    const offset = ico.readUInt32LE(entry + 12);
    assert.ok(offset + length <= ico.length, `ICO entry ${index} runs past the end of the file`);
    assert.deepEqual(pngSize(ico.subarray(offset, offset + length)), [width, width]);
    sizes.push(width);
  }
  assert.deepEqual(sizes, [16, 32, 48]);
  assert.ok(ico.length < 15_000, `favicon.ico is ${ico.length} bytes`);
});

test("the touch icon is an opaque 180px PNG", async () => {
  const png = await read("assets/apple-touch-icon.png");
  assert.deepEqual(pngSize(png), [180, 180]);
  assert.equal(png[25], 2, "the touch icon must be RGB without alpha so iOS shows no black fringe");
});

test("the brand mark uses the site palette tokens", async () => {
  const [mark, styles] = await Promise.all([readText("assets/bounder-mark.svg"), readText("styles.css")]);
  const token = (name) => styles.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, "i"))[1].toLowerCase();
  const colours = new Set([...mark.matchAll(/(?:fill|stroke)="(#[0-9a-f]{6})"/gi)].map(([, colour]) => colour.toLowerCase()));
  assert.deepEqual([...colours].sort(), [token("ink"), token("signal")].sort());
});

test("every page declares the ICO fallback, the SVG icon and the touch icon", async () => {
  for (const path of pages) {
    const html = await readText(path);
    const prefix = path === "404.html" ? "/" : "";
    for (const link of [
      `<link rel="icon" href="${prefix}favicon.ico" sizes="32x32">`,
      `<link rel="icon" href="${prefix}assets/bounder-mark.svg" type="image/svg+xml">`,
      `<link rel="apple-touch-icon" href="${prefix}assets/apple-touch-icon.png">`
    ]) {
      assert.ok(html.includes(link), `${path} is missing ${link}`);
    }
  }
});

test("every published image has a provenance row in images/CREDITS.md", async () => {
  const credits = await readText("images/CREDITS.md");
  const files = (await readdir(new URL("../images/", import.meta.url))).filter((name) => name !== "CREDITS.md" && !name.startsWith("."));
  assert.ok(files.length > 0);
  for (const name of files) {
    assert.match(credits, new RegExp(`^\\| \`${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\` \\|`, "m"), `images/${name} has no credit row`);
  }
});

test("interior pages link the home page by its canonical root, not index.html", async () => {
  for (const path of ["simulator.html", "contact.html", "privacy.html", "terms.html"]) {
    assert.doesNotMatch(await readText(path), /href="index\.html/, `${path} links a duplicate home URL`);
  }
});

test("interior pages mark their own navigation link as the current page", async () => {
  const expected = { "contact.html": 2, "privacy.html": 1, "terms.html": 1 };
  for (const [path, count] of Object.entries(expected)) {
    const html = await readText(path);
    const current = [...html.matchAll(/<a href="([^"]+)" aria-current="page">/g)];
    assert.equal(current.length, count, `${path} marks ${current.length} current links`);
    for (const [, href] of current) assert.equal(href, path);
  }
});

test("the privacy notice describes the hosts, lawful basis, transfers and complaint route the site actually has", async () => {
  const html = await readText("privacy.html");
  assert.doesNotMatch(html, /external asset providers/);
  assert.match(html, /hosted on GitHub Pages/);
  assert.match(html, /loads no fonts, scripts, or images from other providers/);
  assert.match(html, /<h2>Lawful basis<\/h2>/);
  assert.match(html, /<h2>Where your information is processed<\/h2>/);
  assert.match(html, /Continue on Formspree/);
  assert.match(html, /Information Commissioner’s Office/);
  // The notice's storage claim must stay true of the first-party code it describes.
  const rootScripts = (await readdir(new URL("../", import.meta.url))).filter((name) => name.endsWith(".js"));
  const nested = [];
  for (const directory of ["ui", "simulator", "runtime"]) {
    for (const entry of await readdir(new URL(`../${directory}/`, import.meta.url), { recursive: true })) {
      if (entry.endsWith(".js")) nested.push(`${directory}/${entry}`);
    }
  }
  for (const path of [...rootScripts, ...nested]) {
    assert.doesNotMatch(await readText(path), /localStorage|sessionStorage|document\.cookie|indexedDB/, `${path} now uses browser storage`);
  }
});
