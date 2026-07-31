#!/usr/bin/env node
/**
 * Local preview server.
 *
 * Serves the site under the same base path the build was made for, so what you
 * see locally matches what the host serves. Without this, a base-pathed build
 * would appear broken on a plain root server — and the tempting fix (rebuild
 * without the base) is exactly what breaks the deployed site.
 *
 *   npm run serve            → http://127.0.0.1:8000<basePath>/
 *   PORT=3000 npm run serve
 */

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, normalize, extname } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const site = JSON.parse(await readFile(join(ROOT, "data/site.json"), "utf8"));

const BASE = (process.env.BASE_PATH ?? site.basePath ?? "")
  .trim()
  .replace(/\/+$/, "")
  .replace(/^(?!\/)(.+)/, "/$1");

const PORT = Number(process.env.PORT || 8000);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".txt": "text/plain; charset=utf-8",
};

const send = (res, code, body, type = "text/plain; charset=utf-8") => {
  res.writeHead(code, { "content-type": type });
  res.end(body);
};

createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, "http://x").pathname);

  if (BASE) {
    if (path === BASE) {
      // Redirect so relative URLs resolve against the directory, not its parent.
      res.writeHead(302, { location: `${BASE}/` });
      return res.end();
    }
    if (!path.startsWith(`${BASE}/`)) {
      return send(
        res,
        404,
        `This build is served under ${BASE}/\n\nTry http://127.0.0.1:${PORT}${BASE}/\n`
      );
    }
    path = path.slice(BASE.length);
  }

  // normalize() collapses any ../ before it can escape the project directory.
  let file = join(ROOT, normalize(path));
  if (!file.startsWith(ROOT)) return send(res, 403, "Forbidden");

  try {
    if ((await stat(file)).isDirectory()) file = join(file, "index.html");
  } catch {
    /* fall through to the 404 handler below */
  }

  try {
    const body = await readFile(file);
    send(res, 200, body, TYPES[extname(file)] || "application/octet-stream");
  } catch {
    try {
      send(res, 404, await readFile(join(ROOT, "404.html")), TYPES[".html"]);
    } catch {
      send(res, 404, "Not found");
    }
  }
}).listen(PORT, "127.0.0.1", () => {
  console.log(`\n  Serving on http://127.0.0.1:${PORT}${BASE}/`);
  console.log(`  Base path: ${BASE || "none"}\n`);
});
