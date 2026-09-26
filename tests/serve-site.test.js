import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  DEFAULT_HOST,
  MIME_TYPES,
  contentTypeFor,
  createRequestHandler,
  parseServeArguments,
  requestSegments,
  resolveRequest,
  runServeSiteCli,
  startStaticServer
} from "../scripts/serve-site.mjs";

async function fixtureRoot(t) {
  const parent = await mkdtemp(join(tmpdir(), "bounder-serve-site-"));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const root = join(parent, "site");
  await mkdir(join(root, "runtime", "policy"), { recursive: true });
  await mkdir(join(root, "guides"), { recursive: true });
  await mkdir(join(root, "empty"), { recursive: true });
  await writeFile(join(root, "index.html"), "<h1>home</h1>");
  await writeFile(join(root, "404.html"), "<h1>missing</h1>");
  await writeFile(join(root, "guides", "index.html"), "<h1>guides</h1>");
  await writeFile(join(root, "runtime", "policy", "core.js"), "export const core = 1;\n");
  await writeFile(join(root, "runtime", "policy", "entry.mjs"), "export {};\n");
  await writeFile(join(root, "VERSION"), "1.2.3\n");
  await writeFile(join(parent, "secret.txt"), "outside the served tree\n");
  return { parent, root };
}

function fetchRaw(port, path, method = "GET") {
  return new Promise((resolvePromise, rejectPromise) => {
    const request = httpRequest({ host: DEFAULT_HOST, port, path, method }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolvePromise({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString("utf8") }));
    });
    request.on("error", rejectPromise);
    request.end();
  });
}

async function serve(t, root) {
  const server = await startStaticServer({ root, port: 0, logger: { error() {} } });
  t.after(() => new Promise((resolvePromise) => server.close(resolvePromise)));
  assert.equal(server.address().address, DEFAULT_HOST, "the acceptance server must bind to loopback");
  return server.address().port;
}

test("module, data and page types are served with the MIME types browsers enforce", () => {
  assert.equal(contentTypeFor("simulator.js"), "text/javascript; charset=utf-8");
  assert.equal(contentTypeFor("runtime/entry.mjs"), "text/javascript; charset=utf-8");
  assert.equal(contentTypeFor("data/bounder-receipts.v1.json"), "application/json; charset=utf-8");
  assert.equal(contentTypeFor("assets/bounder-mark.svg"), "image/svg+xml");
  assert.equal(contentTypeFor("favicon.ico"), "image/x-icon");
  assert.equal(contentTypeFor("images/hero.WEBP"), "image/webp");
  assert.equal(contentTypeFor("CNAME"), "application/octet-stream");
  assert.equal(Object.isFrozen(MIME_TYPES), true);
});

test("request targets that could leave the served tree are refused before any lookup", () => {
  assert.deepEqual(requestSegments("/"), ["index.html"]);
  assert.deepEqual(requestSegments("/simulator.html?embed=1#stage"), ["simulator.html"]);
  assert.deepEqual(requestSegments("/guides/"), ["guides", "index.html"]);
  assert.deepEqual(requestSegments("/a%20b.txt"), ["a b.txt"]);
  assert.equal(requestSegments("/..%2Fsecret.txt"), null);
  assert.equal(requestSegments("/a%00b"), null);
  assert.equal(requestSegments("/a%5Cb"), null);
  assert.equal(requestSegments("/%E0%A4%A"), null);
  assert.equal(requestSegments("/a//b"), null);
  assert.deepEqual(requestSegments("/a/../index.html"), ["index.html"], "the URL parser resolves dot segments before decoding");
});

test("the server serves files, redirects directories, lists nothing and answers misses with the 404 page", async (t) => {
  const { root } = await fixtureRoot(t);
  const port = await serve(t, root);

  const home = await fetchRaw(port, "/");
  assert.equal(home.status, 200);
  assert.equal(home.body, "<h1>home</h1>");
  assert.equal(home.headers["content-type"], "text/html; charset=utf-8");
  assert.equal(home.headers["cache-control"], "no-store");
  assert.equal(home.headers["x-content-type-options"], "nosniff");

  const module = await fetchRaw(port, "/runtime/policy/core.js?v=1");
  assert.equal(module.status, 200);
  assert.equal(module.headers["content-type"], "text/javascript; charset=utf-8");
  assert.equal(module.headers["content-length"], String(Buffer.byteLength("export const core = 1;\n")));

  const head = await fetchRaw(port, "/runtime/policy/entry.mjs", "HEAD");
  assert.equal(head.status, 200);
  assert.equal(head.body, "");
  assert.equal(head.headers["content-length"], String(Buffer.byteLength("export {};\n")));

  const redirect = await fetchRaw(port, "/guides?x=1");
  assert.equal(redirect.status, 301);
  assert.equal(redirect.headers.location, "/guides/?x=1");
  assert.equal((await fetchRaw(port, "/guides/")).body, "<h1>guides</h1>");

  for (const path of ["/runtime/", "/runtime", "/empty/", "/missing.js", "/index.html/extra"]) {
    const missing = await fetchRaw(port, path);
    assert.equal(missing.status, 404, path);
    assert.equal(missing.body, "<h1>missing</h1>", `${path} must not produce a directory listing`);
  }

  const traversal = await fetchRaw(port, "/..%2Fsecret.txt");
  assert.equal(traversal.status, 400);
  assert.doesNotMatch(traversal.body, /outside the served tree/);

  const post = await fetchRaw(port, "/index.html", "POST");
  assert.equal(post.status, 405);
  assert.equal(post.headers.allow, "GET, HEAD");

  assert.equal((await fetchRaw(port, "/VERSION")).headers["content-type"], "application/octet-stream");
});

test("symlinks resolving outside the root are misses, and a root without a 404 page still answers", async (t) => {
  const { parent, root } = await fixtureRoot(t);
  await symlink(join(parent, "secret.txt"), join(root, "leak.txt"));
  await symlink(join(root, "index.html"), join(root, "alias.html"));
  assert.deepEqual(await resolveRequest(root, "/leak.txt"), { status: 404 });
  assert.equal((await resolveRequest(root, "/alias.html")).status, 200);

  const bare = join(parent, "bare");
  await mkdir(bare);
  const port = await serve(t, bare);
  const missing = await fetchRaw(port, "/nothing");
  assert.equal(missing.status, 404);
  assert.equal(missing.body, "Not found\n");
  assert.equal(missing.headers["content-type"], "text/plain; charset=utf-8");
});

test("unexpected filesystem failures become a 500 and never a hung request", async () => {
  const failing = {
    realpath: async () => { throw Object.assign(new Error("disk gone"), { code: "EIO" }); }
  };
  const logged = [];
  const handler = createRequestHandler({ root: "/fixture", fsApi: failing, logger: { error: (line) => logged.push(line) } });
  const response = {
    headersSent: false,
    writeHead(status, headers) { this.status = status; this.headers = headers; this.headersSent = true; },
    end(body) { this.body = body; }
  };
  await handler({ method: "GET", url: "/index.html" }, response);
  assert.equal(response.status, 500);
  assert.match(logged[0], /disk gone/);

  let destroyed = null;
  const streaming = { headersSent: true, destroy(error) { destroyed = error; } };
  await createRequestHandler({ root: "/fixture", fsApi: failing, logger: { error() { throw new Error("sink"); } } })({ url: "/" }, streaming);
  assert.match(destroyed.message, /disk gone/);

  const stat = async () => { throw Object.assign(new Error("denied"), { code: "EACCES" }); };
  await assert.rejects(() => resolveRequest("/fixture", "/x", { realpath: async (path) => path, stat }), /denied/);
  assert.throws(() => createRequestHandler({ root: "" }), /non-empty path/);
});

test("the CLI requires an explicit root and port, and refuses a file as the served root", async (t) => {
  assert.deepEqual(parseServeArguments(["--root", "_site", "--port", "4173"]), { root: "_site", host: DEFAULT_HOST, port: 4173 });
  assert.deepEqual(parseServeArguments(["--root", "_site", "--host", "::1", "--port", "80"]).host, "::1");
  assert.throws(() => parseServeArguments([]), /usage/);
  assert.throws(() => parseServeArguments(["--root"]), /requires a value/);
  assert.throws(() => parseServeArguments(["--directory", "_site"]), /unknown serve-site argument/);
  assert.throws(() => parseServeArguments(["--root", "_site", "--port", "0"]), /--port must be/);
  assert.throws(() => parseServeArguments(["--root", "_site"]), /--port must be/);

  const { root } = await fixtureRoot(t);
  await assert.rejects(() => startStaticServer({ root: join(root, "index.html") }), /must be a directory/);

  const logged = [];
  const fake = { address: () => ({ address: "127.0.0.1", port: 4173 }) };
  const server = await runServeSiteCli(["--root", root, "--port", "4173"], {
    logger: { log: (line) => logged.push(line) },
    start: async (options) => {
      assert.equal(options.host, DEFAULT_HOST);
      return fake;
    }
  });
  assert.equal(server, fake);
  assert.match(logged[0], /^Serving .+ at http:\/\/127\.0\.0\.1:4173\/$/);

  const occupied = await startStaticServer({ root, port: 0 });
  t.after(() => new Promise((resolvePromise) => occupied.close(resolvePromise)));
  await assert.rejects(() => startStaticServer({ root, port: occupied.address().port }), /EADDRINUSE/);
});
