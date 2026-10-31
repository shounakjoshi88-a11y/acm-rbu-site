#!/usr/bin/env node
/**
 * Assemble the ACM RBU site into dist/.
 *
 * Pure static output: the page, its styles, the 3D scene and the vendored
 * three.js module, plus the media folder (logo, photos, self-hosted fonts).
 * Nothing is generated for the visitor and nothing needs a server.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SITE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(SITE, "src");
const DIST = path.join(SITE, "dist");

const log = (...a) => console.log(...a);
const FILES = [
  "index.html",
  "net.html",
  "site.css",
  "net.css",
  "fonts.css",
  "scene.js",
  "net.js",
  "robots.txt",
  "sitemap.xml",
];
const DIRS = ["media", "vendor"];

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

for (const f of FILES) {
  const from = path.join(SRC, f);
  if (!fs.existsSync(from)) {
    console.error(`missing ${from}`);
    process.exit(1);
  }
  fs.copyFileSync(from, path.join(DIST, f));
  log("copy", f);
}

for (const d of DIRS) {
  const from = path.join(SRC, d);
  if (!fs.existsSync(from)) {
    console.error(`missing ${from}`);
    process.exit(1);
  }
  fs.cpSync(from, path.join(DIST, d), { recursive: true });
  log("copy", d + "/");
}

let bytes = 0;
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p);
    else bytes += fs.statSync(p).size;
  }
};
walk(DIST);
log(`built ${(bytes / 1024).toFixed(0)} KB into ${path.relative(SITE, DIST)}/`);
