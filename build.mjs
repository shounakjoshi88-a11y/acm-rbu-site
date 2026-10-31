#!/usr/bin/env node
/**
 * Assemble the ACM RBU site into dist/.
 *
 * Pure static output: four root files plus the media folder (logo, photos,
 * self-hosted fonts). Nothing is generated for the visitor and nothing needs
 * a server.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SITE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(SITE, "src");
const DIST = path.join(SITE, "dist");

const log = (...a) => console.log(...a);
const FILES = ["index.html", "site.css", "fonts.css", "machine.js", "robots.txt", "sitemap.xml"];

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

for (const f of FILES) {
  const from = path.join(SRC, f);
  if (!fs.existsSync(from)) {
    console.error(`missing ${from}`);
    process.exit(1);
  }
  if (f === "index.html") {
    /* inline the mainboard drawing: one request fewer, and it can be
       styled and animated by the page's own CSS */
    const boardPath = path.join(SRC, "board.svg");
    if (!fs.existsSync(boardPath)) {
      console.error("missing src/board.svg — run node tools/board.mjs");
      process.exit(1);
    }
    const html = fs.readFileSync(from, "utf8").replace(
      "<!--BOARD-->",
      fs.readFileSync(boardPath, "utf8").trim()
    );
    fs.writeFileSync(path.join(DIST, f), html, "utf8");
  } else {
    fs.copyFileSync(from, path.join(DIST, f));
  }
  log("copy", f);
}

fs.cpSync(path.join(SRC, "media"), path.join(DIST, "media"), { recursive: true });
log("copy", "media/");

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
