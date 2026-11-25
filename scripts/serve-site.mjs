import { createReadStream } from "node:fs";
import { createServer } from "node:http";
import * as nodeFs from "node:fs/promises";
import { extname, join, relative, resolve, sep } from "node:path";

import { isMainModule } from "./lib/cli-helpers.mjs";

// Static server for browser acceptance against the built _site. It replaces `python3 -m
// http.server`, whose listen backlog of five and HTTP/1.0 connection-per-request behaviour
// reset ES-module fetches under host load, so random browser tests fell into the simulator's
// fallback states for reasons that had nothing to do with the site. Node keeps connections
// alive and listens with the platform backlog. The server is read-only, serves no directory
// listings, answers misses with the site's own 404 page, and binds to loopback by default.

export const DEFAULT_HOST = "127.0.0.1";
export const LISTEN_BACKLOG = 511;

export const MIME_TYPES = Object.freeze({
  ".avif": "image/avif",
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".mp4": "video/mp4",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".vtt": "text/vtt; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".xml": "application/xml"
});

export function contentTypeFor(path) {
  return MIME_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream";
}

// Returns the request's path segments, or null when the target cannot name a file under the
// root: undecodable escapes, NUL, backslashes and dot segments are refused outright rather than
// normalised, so no spelling of a request can climb out of the served tree.
export function requestSegments(target) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(target, "http://localhost").pathname);
  } catch {
    return null;
  }
  if (!pathname.startsWith("/") || pathname.includes("\0") || pathname.includes("\\")) return null;
  const segments = pathname.slice(1).split("/");
  if (segments.slice(0, -1).some((segment) => segment === "")) return null;
  if (segments.some((segment) => segment === "." || segment === "..")) return null;
  if (segments.at(-1) === "") segments[segments.length - 1] = "index.html";
  return segments;
}

function isContained(root, candidate) {
  const fromRoot = relative(root, candidate);
  return fromRoot !== "" && fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`) && !fromRoot.startsWith(sep);
}

async function statOrNull(path, fsApi) {
  try {
    return await fsApi.stat(path);
  } catch (error) {
    if (["ENOENT", "ENOTDIR", "ENAMETOOLONG"].includes(error?.code)) return null;
    throw error;
  }
}

// Resolves a request to { status, path?, location? }. Symlinks are followed only when their
// real target stays inside the real root.
export async function resolveRequest(root, target, fsApi = nodeFs) {
  const segments = requestSegments(target);
  if (!segments) return { status: 400 };
  const realRoot = await fsApi.realpath(root);
  const candidate = join(realRoot, ...segments);
  const info = await statOrNull(candidate, fsApi);
  if (!info) return { status: 404 };
  const realCandidate = await fsApi.realpath(candidate);
  if (!isContained(realRoot, realCandidate)) return { status: 404 };
  if (info.isDirectory()) {
    // Mirror GitHub Pages: a directory with an index redirects to its slash form.
    const index = await statOrNull(join(realCandidate, "index.html"), fsApi);
    if (!index?.isFile()) return { status: 404 };
    const url = new URL(target, "http://localhost");
    return { status: 301, location: `${url.pathname}/${url.search}` };
  }
  if (!info.isFile()) return { status: 404 };
  return { status: 200, path: realCandidate, size: info.size };
}

const STATUS_TEXT = Object.freeze({
  400: "Bad request\n",
  404: "Not found\n",
  405: "Method not allowed\n",
  416: "Range not satisfiable\n",
  500: "Internal server error\n"
});

export function parseByteRange(header, size) {
  if (typeof header !== "string" || !header.startsWith("bytes=")) return { kind: "none" };
  const spec = header.slice(6).trim();
  if (!spec || spec.includes(",")) return { kind: "none" };
  const match = /^(\d*)-(\d*)$/.exec(spec);
  if (!match || (!match[1] && !match[2])) return { kind: "none" };
  if (size === 0) return { kind: "unsatisfiable" };
  let start;
  let end;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix === 0) return { kind: "unsatisfiable" };
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || start > end) {
      return { kind: "unsatisfiable" };
    }
  }
  return { kind: "range", start, end };
}

async function notFoundBody(root, fsApi) {
  try {
    return { body: await fsApi.readFile(join(await fsApi.realpath(root), "404.html")), type: MIME_TYPES[".html"] };
  } catch {
    return { body: Buffer.from(STATUS_TEXT[404]), type: MIME_TYPES[".txt"] };
  }
}

function send(response, method, status, headers, body = Buffer.alloc(0)) {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Length": body.byteLength,
    ...headers
  });
  response.end(method === "HEAD" ? undefined : body);
}

function streamFile(response, method, path, size, rangeHeader, openStream) {
  const range = parseByteRange(rangeHeader, size);
  if (range.kind === "unsatisfiable") {
    send(response, method, 416, {
      "Accept-Ranges": "bytes",
      "Content-Range": `bytes */${size}`,
      "Content-Type": MIME_TYPES[".txt"]
    }, Buffer.from(STATUS_TEXT[416]));
    return Promise.resolve();
  }
  const partial = range.kind === "range";
  const start = partial ? range.start : 0;
  const end = partial ? range.end : size - 1;
  const length = partial ? end - start + 1 : size;
  const headers = {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Accept-Ranges": "bytes",
    "Content-Type": contentTypeFor(path),
    "Content-Length": length,
    ...(partial ? { "Content-Range": `bytes ${start}-${end}/${size}` } : {})
  };
  if (method === "HEAD" || length === 0) {
    response.writeHead(partial ? 206 : 200, headers);
    response.end();
    return Promise.resolve();
  }
  return new Promise((resolvePromise, rejectPromise) => {
    const stream = openStream(path, partial ? { start, end } : undefined);
    stream.once("error", (error) => rejectPromise(error));
    stream.once("open", () => {
      response.writeHead(partial ? 206 : 200, headers);
      const done = () => {
        if (!stream.destroyed) stream.destroy();
        resolvePromise();
      };
      response.once("close", done);
      response.once("finish", done);
      stream.pipe(response);
    });
  });
}

export function createRequestHandler({ root, fsApi = nodeFs, openStream = createReadStream, logger = console } = {}) {
  if (typeof root !== "string" || root.length === 0) throw new TypeError("root must be a non-empty path");
  const absoluteRoot = resolve(root);
  return async function handle(request, response) {
    const method = request.method ?? "GET";
    try {
      if (method !== "GET" && method !== "HEAD") {
        send(response, method, 405, { Allow: "GET, HEAD", "Content-Type": MIME_TYPES[".txt"] }, Buffer.from(STATUS_TEXT[405]));
        return;
      }
      const resolved = await resolveRequest(absoluteRoot, request.url ?? "/", fsApi);
      if (resolved.status === 200) {
        await streamFile(response, method, resolved.path, resolved.size, request.headers?.range, openStream);
      } else if (resolved.status === 301) {
        send(response, method, 301, { Location: resolved.location, "Content-Type": MIME_TYPES[".txt"] });
      } else if (resolved.status === 404) {
        const { body, type } = await notFoundBody(absoluteRoot, fsApi);
        send(response, method, 404, { "Content-Type": type }, body);
      } else {
        send(response, method, resolved.status, { "Content-Type": MIME_TYPES[".txt"] }, Buffer.from(STATUS_TEXT[resolved.status]));
      }
    } catch (error) {
      try {
        logger?.error?.(`serve-site: ${request.url}: ${error.message}`);
      } catch {
        // A broken diagnostic sink must not turn a 500 into a hung request.
      }
      if (!response.headersSent) send(response, method, 500, { "Content-Type": MIME_TYPES[".txt"] }, Buffer.from(STATUS_TEXT[500]));
      else response.destroy(error);
    }
  };
}

export async function startStaticServer({ root, host = DEFAULT_HOST, port = 0, fsApi = nodeFs, logger = console } = {}) {
  const info = await fsApi.stat(resolve(root));
  if (!info.isDirectory()) throw new Error(`served root must be a directory: ${root}`);
  const server = createServer(createRequestHandler({ root, fsApi, logger }));
  await new Promise((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen({ host, port, backlog: LISTEN_BACKLOG }, () => {
      server.off("error", rejectPromise);
      resolvePromise();
    });
  });
  return server;
}

export function parseServeArguments(args) {
  const options = { root: null, host: DEFAULT_HOST, port: null };
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index];
    if (!["--root", "--host", "--port"].includes(name)) throw new Error(`unknown serve-site argument: ${name}`);
    const value = args[index += 1];
    if (!value) throw new Error(`${name} requires a value`);
    options[name.slice(2)] = value;
  }
  if (!options.root) throw new Error("usage: node scripts/serve-site.mjs --root <dir> --port <port> [--host <host>]");
  const port = Number(options.port);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) throw new Error(`--port must be an integer from 1 to 65535: ${options.port}`);
  return { root: options.root, host: options.host, port };
}

// Playwright starts its web server in a separate process group, so a runner that is
// killed (a verify phase timeout, a stopped task) cannot take the server with it, and the
// orphan keeps the port. Re-parenting is the one signal that always arrives: when the
// launching process dies, the parent pid changes, and the server closes and exits.
export function exitWithParent(server, {
  getParentPid = () => process.ppid,
  intervalMs = 1_000,
  exit = () => process.exit(0)
} = {}) {
  const parentPid = getParentPid();
  const timer = setInterval(() => {
    if (getParentPid() === parentPid) return;
    clearInterval(timer);
    server.close(() => exit());
    server.closeAllConnections?.();
  }, intervalMs);
  timer.unref?.();
  return timer;
}

export async function runServeSiteCli(args = process.argv.slice(2), { logger = console, start = startStaticServer, watchParent = exitWithParent } = {}) {
  const options = parseServeArguments(args);
  const server = await start({ ...options, logger });
  const address = server.address();
  logger.log(`Serving ${options.root} at http://${address.address}:${address.port}/`);
  watchParent(server);
  return server;
}

/* c8 ignore start -- direct-entry failure plumbing is covered through the exported command API. */
if (isMainModule(import.meta.url)) {
  runServeSiteCli().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
/* c8 ignore stop */
