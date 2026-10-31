#!/usr/bin/env node
/**
 * Download the site's webfonts and regenerate src/fonts.css from Google Fonts.
 *
 * Google serves one @font-face per unicode subset. Keeping the subsets and
 * their unicode-range intact matters: without ranges, the browser keeps only
 * the last face of a family+weight and non-latin glyphs (or everything) fall
 * back to system fonts.
 *
 * Fonts are the ones Modal uses on their own site: Inter for text, Fira Mono
 * for the machine labels.
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
  {
    family: "Inter",
    slug: "Inter",
    url: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap",
  },
  {
    family: "Fira Mono",
    slug: "Fira-Mono",
    url: "https://fonts.googleapis.com/css2?family=Fira+Mono:wght@400;500&display=swap",
  },
];

const get = (url, as = "text") =>
  fetch(url, { headers: { "User-Agent": UA } }).then((r) => {
    if (!r.ok) throw new Error(`${r.status} ${url}`);
    return as === "text" ? r.text() : r.arrayBuffer();
  });

fs.mkdirSync(FONT_DIR, { recursive: true });
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
    const dest = path.join(FONT_DIR, file);
    if (!fs.existsSync(dest)) {
      const buf = await get(url, "buffer");
      fs.writeFileSync(dest, Buffer.from(buf));
      console.log(`download ${file} (${(buf.byteLength / 1024).toFixed(1)} KB)`);
    }
    out.push(
      `@font-face{font-family:'${src.family}';font-style:normal;font-weight:${weight};font-display:swap;` +
        `src:url('media/fonts/${file}') format('woff2');unicode-range:${range};}`
    );
  }
}

fs.writeFileSync(OUT, out.join("\n") + "\n", "utf8");
console.log(`wrote ${out.length} @font-face rules to ${path.relative(ROOT, OUT)}`);
