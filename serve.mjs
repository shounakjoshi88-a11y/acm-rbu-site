#!/usr/bin/env node
/** Dev-only static server for dist/. node serve.mjs [port] */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SITE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(SITE, "dist");
const PORT = Number(process.argv[2] || 4174);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
};

http
  .createServer((req, res) => {
    const url = decodeURIComponent((req.url || "/").split("?")[0].split("#")[0]);
    let file = path.join(ROOT, path.normalize(url).replace(/^([/\\])+/, ""));
    if (!file.startsWith(ROOT)) {
      res.writeHead(403).end("forbidden");
      return;
    }
    if (url.endsWith("/")) file = path.join(file, "index.html");
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) {
        res.writeHead(404, { "content-type": "text/plain" }).end("not found");
        return;
      }
      res.writeHead(200, {
        "content-type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream",
        "cache-control": "no-store",
      });
      fs.createReadStream(file).pipe(res);
    });
  })
  .listen(PORT, "127.0.0.1", () => console.log(`serving dist/ on http://127.0.0.1:${PORT}`));
