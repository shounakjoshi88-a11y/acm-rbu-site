#!/usr/bin/env node
/**
 * Draw the chapter's mainboard.
 *
 * Emits src/board.svg — an engineering drawing of a computer mainboard:
 * CPU socket with the ACM die, heatsink and fan, QFP/BGA packages, SOIC
 * chips, electrolytics, resistor arrays, a 40-pin header, edge fingers,
 * routed traces, dimension lines and a title block.
 *
 * The board is line art on purpose: it reads as a drawing (a real object
 * documented) rather than as decorative circuitry. Scroll powers it up by
 * raising --p on the hero; the SVG groups respond through CSS.
 *
 * Deterministic: seeded RNG, so rebuilds are byte-identical.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "src", "board.svg");

/* ------------------------------------------------------------ geometry --- */

const W = 1200;
const H = 820;
const PAD = { l: 46, r: 46, t: 40, b: 40 };

const mulberry32 = (a) => () => {
  a |= 0;
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const rnd = mulberry32(20181018);
const pick = (arr) => arr[(rnd() * arr.length) | 0];
const r1 = (v) => Math.round(v * 10) / 10;

const out = [];
const add = (s) => out.push(s);

const rect = (x, y, w, h, cls = "", extra = "") =>
  `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}"${cls ? ` class="${cls}"` : ""}${extra}/>`;

const line = (x1, y1, x2, y2, cls = "") =>
  `<line x1="${r1(x1)}" y1="${r1(y1)}" x2="${r1(x2)}" y2="${r1(y2)}"${cls ? ` class="${cls}"` : ""}/>`;

const circle = (cx, cy, r, cls = "") =>
  `<circle cx="${r1(cx)}" cy="${r1(cy)}" r="${r1(r)}"${cls ? ` class="${cls}"` : ""}/>`;

const text = (x, y, str, cls = "silk", size = 9, anchor = "start") =>
  `<text x="${r1(x)}" y="${r1(y)}" class="${cls}" font-size="${size}" text-anchor="${anchor}">${str}</text>`;

/* chamfered board outline */
function boardPath() {
  const c = 20;
  const x0 = PAD.l;
  const y0 = PAD.t;
  const x1 = W - PAD.r;
  const y1 = H - PAD.b;
  return `M${x0 + c} ${y0}H${x1 - c}L${x1} ${y0 + c}V${y1 - c}L${x1 - c} ${y1}H${x0 + c}L${x0} ${y1 - c}V${y0 + c}Z`;
}

/* -------------------------------------------------------------- traces --- */

/** orthogonal route with one 45° bend, from a to b */
function route(x0, y0, x1, y1) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  const d = Math.min(ax, ay);
  const sx = Math.sign(dx);
  const sy = Math.sign(dy);

  if (d < 24) return `M${r1(x0)} ${r1(y0)}H${r1(x1)}V${r1(y1)}`;
  const k = Math.min(d, 40);
  return `M${r1(x0)} ${r1(y0)}H${r1(x0 + sx * k)}L${r1(x0 + sx * k + sx * (d - k))} ${r1(y0 + sy * d)}V${r1(y1)}`;
}

const tracePath = (d) => `<path d="${d}" class="tr"/>`;
const powerPath = (d) => `<path d="${d}" class="tr-live"/>`;

/* ---------------------------------------------------------- components --- */

function qfp(x, y, size, pins, label) {
  const pad = 11;
  const inner = size - pad * 2;
  const g = [`<g class="part">`];
  g.push(rect(x, y, size, size, "pkg"));
  g.push(rect(x + pad, y + pad, inner, inner, "pkg-in"));
  /* pin 1 notch */
  g.push(circle(x + pad + 9, y + pad + 9, 3.4, "pkg-dot"));
  const pitch = inner / pins;
  for (let i = 0; i < pins; i++) {
    const o = x + pad + pitch * (i + 0.5);
    g.push(rect(o - 1.8, y + 2, 3.6, pad - 3, "cpin"));
    g.push(rect(o - 1.8, y + size - pad + 1, 3.6, pad - 3, "cpin"));
    const p = y + pad + pitch * (i + 0.5);
    g.push(rect(x + 2, p - 1.8, pad - 3, 3.6, "cpin"));
    g.push(rect(x + size - pad + 1, p - 1.8, pad - 3, 3.6, "cpin"));
  }
  g.push(text(x + size / 2, y + size + 15, label, "silk", 8.5, "middle"));
  g.push(`</g>`);
  return g.join("");
}

function bga(x, y, size, n, label) {
  const g = [`<g class="part">`];
  g.push(rect(x, y, size, size, "pkg"));
  const m = 10;
  const span = size - m * 2;
  const step = span / (n - 1);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      g.push(circle(x + m + i * step, y + m + j * step, 2.6, "bga"));
    }
  }
  g.push(text(x + size / 2, y + size + 15, label, "silk", 8.5, "middle"));
  g.push(`</g>`);
  return g.join("");
}

function soic(x, y, w, h, label, pins = 4) {
  const g = [`<g class="part">`];
  g.push(rect(x, y, w, h, "pkg"));
  const pitch = h / pins;
  for (let i = 0; i < pins; i++) {
    const p = y + pitch * (i + 0.5);
    g.push(rect(x - 7, p - 1.7, 7, 3.4, "cpin"));
    g.push(rect(x + w, p - 1.7, 7, 3.4, "cpin"));
  }
  g.push(circle(x + 7, y + 7, 2.2, "pkg-dot"));
  g.push(text(x + w / 2, y - 6, label, "silk", 8, "middle"));
  g.push(`</g>`);
  return g.join("");
}

function electrolytic(x, y, r, label) {
  const g = [`<g class="part">`];
  g.push(circle(x, y, r, "cap"));
  g.push(circle(x, y, r - 4.5, "cap-in"));
  /* vent cross */
  g.push(line(x - r * 0.5, y, x + r * 0.5, y, "cap-vent"));
  g.push(line(x, y - r * 0.5, x, y + r * 0.5, "cap-vent"));
  /* polarity band */
  g.push(
    `<path d="M${r1(x - r + 1)} ${r1(y - r * 0.42)}a${r} ${r} 0 0 1 0 ${r1(r * 0.84)}" class="cap-band"/>`
  );
  g.push(text(x, y + r + 13, label, "silk", 8, "middle"));
  g.push(`</g>`);
  return g.join("");
}

function resArray(x, y, count, label) {
  const g = [`<g class="part">`];
  const w = 20;
  const gap = 10;
  for (let i = 0; i < count; i++) {
    const bx = x + i * (w + gap);
    g.push(rect(bx, y, w, 9, "res"));
    g.push(rect(bx - 4, y + 1.6, 4, 5.8, "cpin"));
    g.push(rect(bx + w, y + 1.6, 4, 5.8, "cpin"));
  }
  g.push(text(x, y - 7, label, "silk", 8));
  g.push(`</g>`);
  return g.join("");
}

function header(x, y, cols, rows, pitch, label) {
  const g = [`<g class="part">`];
  g.push(rect(x - 6, y - 6, cols * pitch + 6, rows * pitch + 6, "hdr"));
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      g.push(rect(x + i * pitch, y + j * pitch, 8, 8, "pin-sq"));
    }
  }
  g.push(text(x - 6, y - 12, label, "silk", 8));
  g.push(`</g>`);
  return g.join("");
}

function edgeFingers(x0, x1, y) {
  const g = [`<g class="part">`];
  const n = 30;
  const pitch = (x1 - x0) / n;
  for (let i = 0; i < n; i++) {
    const x = x0 + i * pitch + 1.6;
    g.push(rect(x, y, pitch - 4, 26, "finger"));
  }
  g.push(`</g>`);
  return g.join("");
}

function heatsink(x, y, w, h, cx, cy, r) {
  const g = [`<g class="part">`];
  /* base plate */
  g.push(rect(x, y, w, h, "hs-base"));
  /* fins */
  const fins = 9;
  const gap = (w - 20) / fins;
  for (let i = 0; i < fins; i++) {
    g.push(rect(x + 10 + i * gap, y + 10, gap - 4, h - 20, "fin"));
  }
  /* fan over the middle */
  g.push(circle(cx, cy, r, "fan-ring"));
  g.push(circle(cx, cy, r - 8, "fan-ring2"));
  g.push(
    `<g class="fan-blades" style="transform-origin:${r1(cx)}px ${r1(cy)}px">` +
      Array.from({ length: 7 })
        .map((_, i) => {
          const a = (i / 7) * Math.PI * 2;
          const bx = cx + Math.cos(a) * (r - 12);
          const by = cy + Math.sin(a) * (r - 12);
          const rot = (a * 180) / Math.PI;
          return `<ellipse cx="${r1(bx)}" cy="${r1(by)}" rx="${r1(r * 0.34)}" ry="${r1(r * 0.17)}" class="blade" transform="rotate(${r1(rot)} ${r1(bx)} ${r1(by)})"/>`;
        })
        .join("") +
      `</g>`
  );
  g.push(circle(cx, cy, 13, "fan-hub"));
  g.push(circle(cx, cy, 5, "fan-hub2"));
  /* corner screws */
  [
    [x + 9, y + 9],
    [x + w - 9, y + 9],
    [x + 9, y + h - 9],
    [x + w - 9, y + h - 9],
  ].forEach(([sx, sy]) => {
    g.push(circle(sx, sy, 5.4, "screw"));
    g.push(line(sx - 2.6, sy, sx + 2.6, sy, "screw-slot"));
  });
  g.push(text(x + w / 2, y - 8, "HEATSINK / FAN 80 mm", "silk", 8, "middle"));
  g.push(`</g>`);
  return g.join("");
}

/* ---------------------------------------------------------- dimensions --- */

function dimH(y, x0, x1, label) {
  const g = [`<g class="dim">`];
  g.push(line(x0, y, x1, y, "dim-line"));
  g.push(line(x0, y - 7, x0, y + 7, "dim-tick"));
  g.push(line(x1, y - 7, x1, y + 7, "dim-tick"));
  g.push(
    `<path d="M${x0} ${y}l9 -3.2v6.4z" class="dim-arrow"/><path d="M${x1} ${y}l-9 -3.2v6.4z" class="dim-arrow"/>`
  );
  g.push(
    `<rect x="${r1((x0 + x1) / 2 - 24)}" y="${r1(y - 8)}" width="48" height="16" class="dim-plate"/>`
  );
  g.push(text((x0 + x1) / 2, y + 4, label, "dim-text", 9, "middle"));
  g.push(`</g>`);
  return g.join("");
}

function dimV(x, y0, y1, label) {
  const g = [`<g class="dim">`];
  g.push(line(x, y0, x, y1, "dim-line"));
  g.push(line(x - 7, y0, x + 7, y0, "dim-tick"));
  g.push(line(x - 7, y1, x + 7, y1, "dim-tick"));
  g.push(
    `<path d="M${x} ${y0}l-3.2 9h6.4z" class="dim-arrow"/><path d="M${x} ${y1}l-3.2 -9h6.4z" class="dim-arrow"/>`
  );
  g.push(
    `<g transform="translate(${x} ${r1((y0 + y1) / 2)}) rotate(-90)">` +
      `<rect x="-26" y="-8" width="52" height="16" class="dim-plate"/>` +
      text(0, 4, label, "dim-text", 9, "middle") +
      `</g>`
  );
  g.push(`</g>`);
  return g.join("");
}

/* ------------------------------------------------------------ assemble --- */

/* the socket: where the ACM die sits */
const CPU = { x: 830, y: 330, s: 250 };
const cpuCx = CPU.x + CPU.s / 2;
const cpuCy = CPU.y + CPU.s / 2;

const mountHoles = [
  [PAD.l + 22, PAD.t + 22],
  [W - PAD.r - 22, PAD.t + 22],
  [PAD.l + 22, H - PAD.b - 22],
  [W - PAD.r - 22, H - PAD.b - 22],
];

const parts = [];
const silk = [];
const baseTraces = [];
const liveTraces = [];
const leds = [];

/* --- heatsink above the socket --- */
parts.push(heatsink(880, 86, 200, 180, 980, 176, 68));

/* --- CPU socket --- */
parts.push(`<g class="part">`);
parts.push(rect(CPU.x - 16, CPU.y - 16, CPU.s + 32, CPU.s + 32, "socket"));
parts.push(rect(CPU.x - 6, CPU.y - 6, CPU.s + 12, CPU.s + 12, "socket-in"));
parts.push(rect(CPU.x, CPU.y, CPU.s, CPU.s, "die-bed"));
/* socket pins */
const sp = 10;
for (let i = 0; i < 22; i++) {
  const o = CPU.x - 10 + i * ((CPU.s + 20) / 22);
  parts.push(rect(o, CPU.y - 12, 4, 8, "cpin"));
  parts.push(rect(o, CPU.y + CPU.s + 4, 4, 8, "cpin"));
  const q = CPU.y - 10 + i * ((CPU.s + 20) / 22);
  parts.push(rect(CPU.x - 12, q, 8, 4, "cpin"));
  parts.push(rect(CPU.x + CPU.s + 4, q, 8, 4, "cpin"));
}
/* lever + retention */
parts.push(`<path d="M${CPU.x - 30} ${CPU.y + 22}h-14v${CPU.s - 44}h14" class="lever"/>`);
parts.push(circle(CPU.x - 44, CPU.y + 22, 4, "screw"));
parts.push(circle(CPU.x - 44, CPU.y + CPU.s - 22, 4, "screw"));
parts.push(`</g>`);
silk.push(text(cpuCx, CPU.y + CPU.s + 34, "U0 · ACM RBU / REV 8.0", "silk", 9, "middle"));

/* --- packages --- */
parts.push(qfp(150, 560, 130, 12, "U1 · SOC"));
parts.push(qfp(300, 646, 92, 8, "U2"));
parts.push(soic(300, 170, 62, 34, "U4"));
parts.push(soic(300, 234, 62, 34, "U5"));
parts.push(soic(300, 298, 62, 34, "U6"));

/* --- capacitors --- */
const caps = [
  [790, 300, 20, "C1"],
  [790, 356, 15, "C2"],
  [790, 404, 15, "C3"],
  [1118, 330, 22, "C4"],
  [1118, 396, 15, "C5"],
  [150, 740, 20, "C8"],
  [230, 740, 16, "C9"],

];
caps.forEach(([x, y, r, l]) => parts.push(electrolytic(x, y, r, l)));

/* --- resistor arrays + small parts --- */
parts.push(resArray(470, 712, 8, "RN1"));
parts.push(resArray(470, 672, 6, "RN2"));

/* --- 40-pin header --- */
parts.push(header(470, 90, 20, 2, 14, "J1 · 40-pin"));

/* --- edge connector --- */
parts.push(edgeFingers(300, 820, H - PAD.b - 26));
silk.push(text(560, H - PAD.b - 34, "EDGE CONNECTOR · 30 WAY", "silk", 8, "middle"));

/* --- ribbon cable off the header --- */
parts.push(
  `<g class="part"><path d="M470 96C400 96 360 40 352 -30" class="ribbon"/><path d="M470 116C392 116 344 46 336 -30" class="ribbon"/></g>`
);

/* --- routed traces: bus runs, spaced and parallel like a real board --- */
function pushTrace(d, live) {
  baseTraces.push(tracePath(d));
  if (live) liveTraces.push(powerPath(d));
}

/* left bus: board edge to the socket's left side */
for (let i = 0; i < 9; i++) {
  const y = 370 + i * 10;
  pushTrace(`M400 ${y}H640L700 ${y + 60}H${CPU.x}`, i % 2 === 0);
  if (i % 2 === 0) leds.push([640, y]);
}

/* top bus: 40-pin header down into the socket's top edge */
for (let i = 0; i < 5; i++) {
  const x = 500 + i * 9;
  const lane = 168 + i * 9;
  pushTrace(`M${x} 122V${lane}H790L${826 + i * 10} ${lane + 36 + i * 10}V${CPU.y}`, i % 2 === 1);
}

/* bottom bus: socket down to the edge connector */
for (let i = 0; i < 6; i++) {
  const x = 840 + i * 10;
  pushTrace(`M${x} ${CPU.y + CPU.s}V620L${800 - i * 10} 660V754`, i % 2 === 0);
  if (i % 2 === 0) leds.push([800 - i * 10, 660]);
}

/* decoupling caps straight off the socket's left edge */
[300, 356, 404].forEach((y, i) => {
  pushTrace(`M${CPU.x} ${y + 60}H${790 - 20 - 4}`, true);
});

/* socket right edge to the bulk caps */
[330, 396].forEach((y) => pushTrace(`M${CPU.x + CPU.s} ${y}H1096`, true));

/* vias at the bus bends */
[[640, 380], [700, 440], [880, 660], [790, 180]].forEach(([x, y]) => {
  parts.push(circle(x, y, 3.2, "via"));
  parts.push(circle(x, y, 1.4, "via-in"));
});

/* --------------------------------------------------------- title block --- */

const TB = { x: 860, y: 640, w: 300, h: 146 };
const titleBlock = [
  `<g class="tb">`,
  rect(TB.x, TB.y, TB.w, TB.h, "tb-box"),
  line(TB.x, TB.y + 54, TB.x + TB.w, TB.y + 54, "tb-rule"),
  line(TB.x, TB.y + 92, TB.x + TB.w, TB.y + 92, "tb-rule"),
  line(TB.x + 190, TB.y + 54, TB.x + 190, TB.y + TB.h, "tb-rule"),
  text(TB.x + 12, TB.y + 22, "ACM RBU STUDENT CHAPTER", "tb-title", 12),
  text(TB.x + 12, TB.y + 40, "MAINBOARD — CHAPTER SYSTEM", "tb-sub", 9),
  text(TB.x + 12, TB.y + 72, "SHEET", "tb-label", 7.5),
  text(TB.x + 12, TB.y + 86, "1 of 1", "tb-val", 9.5),
  text(TB.x + 202, TB.y + 72, "REV", "tb-label", 7.5),
  text(TB.x + 202, TB.y + 86, "8.0", "tb-val", 9.5),
  text(TB.x + 12, TB.y + 110, "SCALE", "tb-label", 7.5),
  text(TB.x + 12, TB.y + 126, "1:1", "tb-val", 9.5),
  text(TB.x + 202, TB.y + 110, "DRAWN", "tb-label", 7.5),
  text(TB.x + 202, TB.y + 126, "18.10.2018", "tb-val", 9.5),
  text(TB.x + TB.w - 12, TB.y + TB.h - 8, "NAGPUR · IN", "tb-label", 7.5, "end"),
  `</g>`,
].join("");

/* ---------------------------------------------------------------- svg ---- */

add(
  `<svg class="board" viewBox="-52 -76 1304 972" role="img" aria-labelledby="board-t">` +
    `<title id="board-t">Engineering drawing of the chapter's mainboard: a CPU socket holding the ACM die, a fan and heatsink, chips, capacitors, a forty-pin header, routed traces and a title block.</title>`
);

/* dimension lines, outside the board */
add(`<g class="dim">`);
add(dimH(-30, PAD.l, W - PAD.r, "184 mm"));

add(`</g>`);

/* board body */
add(`<g class="bd">`);
add(`<path d="${boardPath()}" class="bd-face"/>`);
add(`<path d="${boardPath()}" class="bd-edge"/>`);
mountHoles.forEach(([x, y]) => {
  add(circle(x, y, 13, "hole"));
  add(circle(x, y, 6.2, "hole-in"));
});
add(`</g>`);

/* silkscreen frame + labels */
add(`<g class="silk-layer">`);
add(rect(PAD.l + 10, PAD.t + 10, W - PAD.l - PAD.r - 20, H - PAD.t - PAD.b - 20, "silk-frame"));
add(text(PAD.l + 48, PAD.t + 30, "ACM RBU · CHAPTER SYSTEM BOARD", "silk", 10));
add(text(PAD.l + 48, PAD.t + 46, "ASSEMBLED 18 OCT 2018 · NAGPUR", "silk", 8));


add(`</g>`);

/* components */
add(`<g class="parts-layer">${parts.join("")}</g>`);

/* traces under the parts, then the power layer above */
add(`<g class="tr-layer">${baseTraces.join("")}</g>`);
add(`<g class="tr-live-layer">${liveTraces.join("")}</g>`);

/* pads + LEDs at the ends of live traces */
add(
  `<g class="pad-layer">` +
    leds
      .map(
        ([x, y], i) =>
          circle(x, y, 4.6, "pad") +
          `<circle cx="${r1(x)}" cy="${r1(y)}" r="7.5" class="led" style="--d:${r1(0.62 + i * 0.045)}"/>`
      )
      .join("") +
    `</g>`
);

/* the die: logo on the socket, dark until powered */
add(
  `<g class="die-layer">` +

    `<rect x="${CPU.x + 8}" y="${CPU.y + 8}" width="${CPU.s - 16}" height="${CPU.s - 16}" class="die-face"/>` +
    `<image href="media/acm-logo-200.png" x="${CPU.x + 58}" y="${CPU.y + 58}" width="134" height="134" class="die-img"/>` +
    `</g>`
);

/* title block */
add(titleBlock);

add(`</svg>`);

fs.writeFileSync(OUT, out.join("\n") + "\n", "utf8");
console.log(`board.svg: ${(fs.statSync(OUT).size / 1024).toFixed(1)} KB`);
