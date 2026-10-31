#!/usr/bin/env node
/**
 * Regenerate src/fonts.css from Google Fonts' CSS, pointing at the
 * self-hosted woff2 files in src/media/fonts/.
 *
 * Google serves one @font-face per unicode subset. Keeping the subsets and
 * their unicode-range intact matters: without ranges, the browser keeps only
 * the last face of a family+weight and non-latin glyphs (or everything)
 * fall back to system fonts.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FONT_DIR = path.join(ROOT, "src", "media", "fonts");
const OUT = path.join(ROOT, "src", "fonts.css");
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const SOURCES = [
  { family: "Space Grotesk", slug: "Space-Grotesk", url: "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&display=swap" },
  { family: "IBM Plex Mono", slug: "IBM-Plex-Mono", url: "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600&display=swap" },
];

const get = (url) =>
  fetch(url, { headers: { "User-Agent": UA } }).then((r) => {
    if (!r.ok) throw new Error(`${r.status} ${url}`);
    return r.text();
  });

const files = new Set(fs.readdirSync(FONT_DIR));
const out = [];

for (const src of SOURCES) {
  const css = await get(src.url);
  const blocks = css.match(/\/\*\s*([\w-]+)\s*\*\/\s*@font-face\s*\{([^}]*)\}/g) || [];
  for (const block of blocks) {
    const subset = block.match(/\/\*\s*([\w-]+)\s*\*\//)[1];
    const body = block.slice(block.indexOf("{") + 1, block.lastIndexOf("}"));
    const weight = body.match(/font-weight:\s*(\d+)/)?.[1];
    const url = body.match(/src:\s*url\(([^)]+\.woff2)\)/)?.[1];
    const range = body.match(/unicode-range:\s*([^;]+);/)?.[1];
    if (!weight || !url || !range) continue;

    const file = `${src.slug}-${weight}-${subset}.woff2`;
    if (!files.has(file)) {
      console.warn(`skip ${file} (not downloaded)`);
      continue;
    }
    out.push(
      `@font-face{font-family:'${src.family}';font-style:normal;font-weight:${weight};font-display:swap;` +
        `src:url('media/fonts/${file}') format('woff2');unicode-range:${range};}`
    );
  }
}

fs.writeFileSync(OUT, out.join("\n") + "\n", "utf8");
console.log(`wrote ${out.length} @font-face rules to ${path.relative(ROOT, OUT)}`);
