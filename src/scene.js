/* ==========================================================================
   ACM RBU — the machine, drawn as a field of glyphs.

   Two passes, the way Modal builds their hero.

   Pass 1 renders the board as real geometry into an off-screen target, so
   every face has a genuine luminance: dim substrate, lit copper, a rim that
   catches the blue key light.

   Pass 2 is a full-screen shader that walks a hexagonal cell grid across that
   image. Each cell samples the scene at its own centre, quantises the
   luminance into tiers with a per-cell dither, and stamps an SDF glyph from an
   atlas — a dot for a dark face, a ring or an asterisk for a lit edge. Nothing
   is a sprite; the whole picture is drawn one cell at a time.

   Scroll pulls the four layers of the board together. Pointer parallax turns
   the stack.
   ========================================================================== */

import * as THREE from "./vendor/three.module.min.js";

const canvas = document.querySelector("[data-stage]");
const hero = document.querySelector(".hero");
const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const BOARD_W = 104;
const BOARD_D = 64;
const GAP = 1.2;

/* --------------------------------------------------------------- helpers -- */

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const lerp = (a, b, t) => a + (b - a) * t;

function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20181018);

function canvas2d(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d", { willReadFrequently: true })];
}

/* ---------------------------------------------------------------- glyphs -- */
/* An SDF atlas, the way Modal store theirs: alpha 0.5 is the outline, higher
   is inside, lower is outside, with a fixed spread of atlas pixels either
   side. The shader then thresholds that field at whatever weight it wants, so
   one texture gives crisp strokes at every size.                            */

const GLYPH_PX = 128;
const SPREAD_PX = 9;
const GLYPHS = 8;

function glyphShapes(g) {
  const c = GLYPH_PX / 2;
  g.clearRect(0, 0, GLYPH_PX, GLYPH_PX);
  g.fillStyle = "#fff";
  g.strokeStyle = "#fff";
  g.lineCap = "round";
  g.lineJoin = "round";

  const circle = (r) => {
    g.beginPath();
    g.arc(c, c, r, 0, Math.PI * 2);
    g.fill();
  };
  const ring = (r, lw) => {
    g.beginPath();
    g.arc(c, c, r, 0, Math.PI * 2);
    g.lineWidth = lw;
    g.stroke();
  };
  const spokes = (n, len, lw) => {
    g.lineWidth = lw;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      g.beginPath();
      g.moveTo(c - Math.cos(a) * len, c - Math.sin(a) * len);
      g.lineTo(c + Math.cos(a) * len, c + Math.sin(a) * len);
      g.stroke();
    }
  };
  const poly = (sides, r, lw) => {
    g.lineWidth = lw;
    g.beginPath();
    for (let i = 0; i <= sides; i++) {
      const a = (i / sides) * Math.PI * 2 - Math.PI / 2;
      const x = c + Math.cos(a) * r;
      const y = c + Math.sin(a) * r;
      i === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
    }
    g.stroke();
  };

  return {
    /* 0 — the dimmest cell: a single grain */
    dot: () => circle(26),
    /* 1 — grain with a halo */
    grain: () => {
      circle(15);
      ring(35, 17);
    },
    /* 2 — an open ring */
    ring: () => ring(37, 20),
    /* 3 — three axes */
    star3: () => spokes(3, 41, 17),
    /* 4 — four axes */
    star4: () => spokes(4, 42, 14),
    /* 5 — ring and cross */
    target: () => {
      ring(39, 17);
      spokes(2, 38, 12);
    },
    /* 6 — square frame */
    square: () => {
      g.lineWidth = 19;
      g.strokeRect(c - 27, c - 27, 54, 54);
    },
    /* 7 — hexagon frame */
    hex: () => poly(6, 43, 18),
  };
}

/* distance transform: how far each pixel is from the shape's edge */
function distanceTo(mask, w, h, target) {
  const INF = 1e9;
  const d = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) d[i] = mask[i] === target ? INF : 0;
  const D1 = 1;
  const D2 = Math.SQRT2;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let best = d[i];
      if (x > 0) best = Math.min(best, d[i - 1] + D1);
      if (y > 0) {
        best = Math.min(best, d[i - w] + D1);
        if (x > 0) best = Math.min(best, d[i - w - 1] + D2);
        if (x < w - 1) best = Math.min(best, d[i - w + 1] + D2);
      }
      d[i] = best;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      let best = d[i];
      if (x < w - 1) best = Math.min(best, d[i + 1] + D1);
      if (y < h - 1) {
        best = Math.min(best, d[i + w] + D1);
        if (x < w - 1) best = Math.min(best, d[i + w + 1] + D2);
        if (x > 0) best = Math.min(best, d[i + w - 1] + D2);
      }
      d[i] = best;
    }
  }
  return d;
}

function buildAtlas() {
  const order = ["dot", "grain", "ring", "star3", "star4", "target", "square", "hex"];
  const w = GLYPH_PX * GLYPHS;
  const h = GLYPH_PX;
  const [atlasCanvas, g] = canvas2d(w, h);
  g.fillStyle = "#000";
  g.fillRect(0, 0, w, h);

  for (let i = 0; i < GLYPHS; i++) {
    const [cell, cg] = canvas2d(GLYPH_PX, GLYPH_PX);
    const shapes = glyphShapes(cg);
    shapes[order[i]](cg);
    const src = cg.getImageData(0, 0, GLYPH_PX, GLYPH_PX).data;
    const mask = new Uint8Array(GLYPH_PX * GLYPH_PX);
    for (let p = 0; p < mask.length; p++) mask[p] = src[p * 4 + 3] >= 128 ? 1 : 0;

    const out = distanceTo(mask, GLYPH_PX, GLYPH_PX, 0);
    const inn = distanceTo(mask, GLYPH_PX, GLYPH_PX, 1);

    const img = g.createImageData(GLYPH_PX, GLYPH_PX);
    for (let p = 0; p < mask.length; p++) {
      /* positive outside, negative inside */
      const signed = out[p] - inn[p];
      const a = clamp(0.5 - signed / (2 * SPREAD_PX), 0, 1) * 255;
      img.data[p * 4] = a;
      img.data[p * 4 + 1] = a;
      img.data[p * 4 + 2] = a;
      img.data[p * 4 + 3] = a;
    }
    g.putImageData(img, i * GLYPH_PX, 0);
  }

  const tex = new THREE.CanvasTexture(atlasCanvas);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

/* -------------------------------------------------------------- tier ramp -- */
/* One texel per tier: rgb is the colour a cell of that tier is drawn in, a is
   the glyph index / 255. Luminance picks the tier, the tier picks the glyph. */

const TIER_COLORS = [
  "#17364f",
  "#1e4a6d",
  "#29648e",
  "#3780b2",
  "#4c99d0",
  "#69b0e8",
  "#9dcff8",
  "#e8f5ff",
];

function buildTiers() {
  const n = TIER_COLORS.length;
  const data = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const c = new THREE.Color(TIER_COLORS[i]);
    data[i * 4] = Math.round(c.r * 255);
    data[i * 4 + 1] = Math.round(c.g * 255);
    data[i * 4 + 2] = Math.round(c.b * 255);
    /* the shader reads this as glyphIndex / 255, so store the index itself */
    data[i * 4 + 3] = Math.round((i / (n - 1)) * (GLYPHS - 1));
  }
  const tex = new THREE.DataTexture(data, n, 1, THREE.RGBAFormat);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

/* ------------------------------------------------------------------ logo -- */
/* The mark ships on white. Key the white out, keep the mark, and push it to
   the chapter's blue so the die reads as lit silicon.                        */

function keyedLogo(img) {
  const S = 512;
  const [c, g] = canvas2d(S, S);
  g.drawImage(img, 0, 0, S, S);
  const d = g.getImageData(0, 0, S, S).data;
  const out = g.createImageData(S, S);

  for (let i = 0; i < d.length; i += 4) {
    const lum = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) / 255;
    const a = clamp((1 - lum) * 1.75, 0, 1);
    const lift = clamp(a * 1.35, 0, 1);
    out.data[i] = Math.round(lerp(30, 214, lift));
    out.data[i + 1] = Math.round(lerp(74, 234, lift));
    out.data[i + 2] = Math.round(lerp(140, 255, lift));
    out.data[i + 3] = Math.round(Math.pow(a, 0.85) * 255);
  }
  g.putImageData(out, 0, 0);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/* --------------------------------------------------------------- geometry -- */

function roundedShape(w, h, r) {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

/* a rounded frame: outer shape with the inner one punched out */
function frameShape(w, h, r, t) {
  const outer = roundedShape(w, h, r);
  const inner = roundedShape(w - t * 2, h - t * 2, Math.max(0.6, r - t));
  outer.holes.push(new THREE.Path(inner.getPoints(28)));
  return outer;
}

function flatShape(shape, depth, bevel) {
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 10,
  });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, -depth / 2, 0);
  return geo;
}

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(26, 1, 1, 4000);
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: false,
  alpha: true,
  powerPreference: "high-performance",
});
renderer.setClearAlpha(0);
renderer.toneMapping = THREE.NoToneMapping;
renderer.autoClear = false;

/* ------------------------------------------------------------- materials -- */

/* These are a shading map, not a picture: the pattern pass takes luminance and
   supplies the colour, so what matters here is contrast between faces. */
const matSubstrate = new THREE.MeshStandardMaterial({
  color: 0x1b2532,
  roughness: 0.5,
  metalness: 0.35,
});

const matCopper = new THREE.MeshStandardMaterial({
  color: 0x9dc0e4,
  roughness: 0.3,
  metalness: 0.55,
  emissive: new THREE.Color(0x4f92da),
  emissiveIntensity: 1.1,
});

const matSolder = new THREE.MeshStandardMaterial({
  color: 0xd6e6f6,
  roughness: 0.3,
  metalness: 0.5,
  emissive: new THREE.Color(0x8fbde8),
  emissiveIntensity: 0.9,
});

const matPart = new THREE.MeshStandardMaterial({
  color: 0x3c4a5b,
  roughness: 0.6,
  metalness: 0.2,
});

const matCeramic = new THREE.MeshStandardMaterial({
  color: 0x74899e,
  roughness: 0.72,
  metalness: 0.05,
});

const matHeatsink = new THREE.MeshStandardMaterial({
  color: 0x51647a,
  roughness: 0.34,
  metalness: 0.8,
});

/* ---------------------------------------------------------------- layers -- */

const stack = new THREE.Group();
scene.add(stack);

const gBoard = new THREE.Group();
const gCopper = new THREE.Group();
const gParts = new THREE.Group();
const gDie = new THREE.Group();
stack.add(gBoard, gCopper, gParts, gDie);

const TOP = 1.6; /* top of the substrate */

/* --- the substrate ------------------------------------------------------- */

const substrate = new THREE.Mesh(flatShape(roundedShape(BOARD_W, BOARD_D, 4), 3.2, 0.22), matSubstrate);
substrate.position.y = TOP - 1.6;
gBoard.add(substrate);

/* the bezel: the silhouette, drawn in light so the edge resolves as glyphs */
const bezel = new THREE.Mesh(flatShape(frameShape(BOARD_W - 2.2, BOARD_D - 2.2, 3.4, 1.5), 0.3, 0), matSolder);
bezel.position.y = TOP + 0.05;
gBoard.add(bezel);

/* mounting pads */
for (const [sx, sz] of [
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
]) {
  const ring = new THREE.Mesh(new THREE.TorusGeometry(2.1, 0.42, 8, 24), matSolder);
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(sx * (BOARD_W / 2 - 5.5), TOP + 0.12, sz * (BOARD_D / 2 - 5.5));
  gBoard.add(ring);
}

/* title block, bottom right */
{
  const bx = BOARD_W * 0.5 - 26;
  const bz = BOARD_D * 0.5 - 13;
  const lines = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const l = new THREE.Mesh(new THREE.BoxGeometry(i === 0 ? 22 : 14 + rnd() * 6, 0.2, 0.42), matPart);
    l.position.set(bx + (i === 0 ? 0 : -2), TOP + 0.16, bz + i * 1.9);
    lines.add(l);
  }
  gBoard.add(lines);
}

/* edge connector: a comb of fingers along the front edge */
{
  const n = 26;
  const span = BOARD_W * 0.42;
  const fingers = new THREE.InstancedMesh(new THREE.BoxGeometry(1.05, 0.5, 4.6), matSolder, n);
  const m = new THREE.Matrix4();
  for (let i = 0; i < n; i++) {
    const x = -span / 2 + (i * span) / (n - 1);
    m.makeTranslation(x, TOP + 0.2, BOARD_D / 2 - 2.2);
    fingers.setMatrixAt(i, m);
  }
  gBoard.add(fingers);
}

/* --- the copper ---------------------------------------------------------- */

function seg(a, b, w, h, mat, parent) {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const len = Math.hypot(dx, dz);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, len + w), mat);
  mesh.position.set((a[0] + b[0]) / 2, TOP + 0.14, (a[1] + b[1]) / 2);
  mesh.rotation.y = Math.atan2(dx, dz);
  parent.add(mesh);
  return mesh;
}

function route(points, w, h = 0.8) {
  for (let i = 0; i < points.length - 1; i++) seg(points[i], points[i + 1], w, h, matCopper, gCopper);
}

const SOCKET = 34; /* socket side, in board units */

/* fan-out, left */
for (let i = 0; i < 9; i++) {
  const z = -SOCKET / 2 + 1.6 + i * (SOCKET / 9);
  const x0 = -SOCKET / 2;
  const x1 = -BOARD_W / 2 + 4 + rnd() * 3;
  const xm = lerp(x0, x1, 0.55);
  route(
    [
      [x0, z],
      [xm, z],
      [x1, z + (i % 2 ? 3.4 : -3.4)],
      [x1, z + (i % 2 ? 6.2 : -6.2)],
    ],
    2.1 + (i % 3 === 0 ? 0.9 : 0)
  );
}
/* fan-out, right */
for (let i = 0; i < 9; i++) {
  const z = -SOCKET / 2 + 1.6 + i * (SOCKET / 9);
  const x0 = SOCKET / 2;
  const x1 = BOARD_W / 2 - 4 - rnd() * 3;
  const xm = lerp(x0, x1, 0.5);
  route(
    [
      [x0, z],
      [xm, z],
      [x1, z + (i % 2 ? -2.6 : 2.6)],
      [x1, z + (i % 2 ? -5.4 : 5.4)],
    ],
    2.1 + (i % 4 === 0 ? 0.8 : 0)
  );
}
/* buses running to the edge connector */
for (let i = 0; i < 8; i++) {
  const x = -BOARD_W * 0.17 + i * 4.2;
  route(
    [
      [x, BOARD_D * 0.22],
      [x, BOARD_D / 2 - 8],
      [x + (i % 2 ? 1.6 : -1.6), BOARD_D / 2 - 4.6],
    ],
    1.9
  );
}
/* short stubs scattered over the free area */
for (let i = 0; i < 26; i++) {
  const x = (rnd() - 0.5) * (BOARD_W - 12);
  const z = (rnd() - 0.5) * (BOARD_D - 12);
  if (Math.abs(x) < SOCKET * 0.72 && Math.abs(z) < SOCKET * 0.72) continue;
  const l = 2.5 + rnd() * 6;
  route(
    [
      [x, z],
      [x + l, z],
      [x + l, z + 1.8],
    ],
    1.8
  );
}

/* vias */
{
  const n = 44;
  const vias = new THREE.InstancedMesh(new THREE.TorusGeometry(1.5, 0.55, 8, 16), matSolder, n);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
  const s = new THREE.Vector3(1, 1, 1);
  let k = 0;
  while (k < n) {
    const x = (rnd() - 0.5) * (BOARD_W - 8);
    const z = (rnd() - 0.5) * (BOARD_D - 8);
    if (Math.abs(x) < SOCKET * 0.6 && Math.abs(z) < SOCKET * 0.6) continue;
    m.compose(new THREE.Vector3(x, TOP + 0.2, z), q, s);
    vias.setMatrixAt(k++, m);
  }
  gCopper.add(vias);
}

/* --- the parts ----------------------------------------------------------- */

/* socket: four walls around the die site */
{
  const w = SOCKET;
  const hgt = 2.4;
  const t = 2.6;
  const walls = [
    [0, -w / 2 + t / 2, w, t],
    [0, w / 2 - t / 2, w, t],
    [-w / 2 + t / 2, 0, t, w - t * 2],
    [w / 2 - t / 2, 0, t, w - t * 2],
  ];
  for (const [x, z, bw, bd] of walls) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(bw, hgt, bd), matCeramic);
    m.position.set(x, TOP + hgt / 2, z);
    gParts.add(m);
  }
  /* a lit frame around the socket, so the core reads at a glance */
  const ring = new THREE.Mesh(flatShape(frameShape(w + 3, w + 3, 1.6, 1.3), 0.3, 0), matSolder);
  ring.position.y = TOP + hgt + 0.05;
  gParts.add(ring);

  /* contact pads inside the socket, around the die site */
  const pads = new THREE.InstancedMesh(new THREE.BoxGeometry(1.1, 0.4, 2.2), matSolder, 48);
  const mm = new THREE.Matrix4();
  let p = 0;
  for (let i = 0; i < 12; i++) {
    const o = -13 + i * 2.2;
    for (const [px, pz] of [
      [o, -13.5],
      [o, 13.5],
      [-13.5, o],
      [13.5, o],
    ]) {
      mm.makeTranslation(px, TOP + 0.3, pz);
      pads.setMatrixAt(p++, mm);
    }
  }
  gParts.add(pads);
}

/* chips */
const CHIPS = [
  [-30, 18, 13, 9, 1.8],
  [-30, 6, 7, 6, 1.4],
  [-20, 24, 8, 7, 1.6],
  [30, -16, 11, 8, 1.8],
  [22, 22, 6, 5, 1.2],
];
for (const [x, z, w, d, hgt] of CHIPS) {
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, hgt, d), matPart);
  body.position.set(x, TOP + hgt / 2, z);
  gParts.add(body);
  /* legs */
  const legs = new THREE.InstancedMesh(new THREE.BoxGeometry(0.7, 0.5, 1.4), matSolder, 6);
  const lm = new THREE.Matrix4();
  for (let i = 0; i < 3; i++) {
    const o = -w * 0.3 + i * w * 0.3;
    lm.makeTranslation(x + o, TOP + 0.24, z + d / 2 + 0.5);
    legs.setMatrixAt(i, lm);
    lm.makeTranslation(x + o, TOP + 0.24, z - d / 2 - 0.5);
    legs.setMatrixAt(i + 3, lm);
  }
  gParts.add(legs);
}

/* heatsink: a base and a comb of fins */
{
  const bx = 28;
  const bz = 4;
  const base = new THREE.Mesh(new THREE.BoxGeometry(17, 1.1, 13), matHeatsink);
  base.position.set(bx, TOP + 0.55, bz);
  gParts.add(base);
  for (let i = 0; i < 8; i++) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.75, 4.2, 12.2), matHeatsink);
    fin.position.set(bx - 7 + i * 2, TOP + 1.1 + 2.1, bz);
    gParts.add(fin);
  }
}

/* capacitors */
for (const [x, z, r, hgt] of [
  [-14, -20, 2.6, 4.4],
  [-9, -20, 1.9, 3.2],
  [40, 20, 2.4, 4],
  [40, 26, 1.7, 3],
  [-38, -22, 2.2, 3.6],
]) {
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(r, r, hgt, 18), matPart);
  cap.position.set(x, TOP + hgt / 2, z);
  gParts.add(cap);
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.96, r * 0.96, 0.35, 18), matSolder);
  lid.position.set(x, TOP + hgt + 0.1, z);
  gParts.add(lid);
}

/* resistor rows */
{
  const n = 20;
  const res = new THREE.InstancedMesh(new THREE.BoxGeometry(2.6, 0.8, 1.3), matPart, n);
  const m = new THREE.Matrix4();
  for (let i = 0; i < n; i++) {
    m.makeTranslation(-44 + (i % 10) * 3.4, TOP + 0.4, 27 + Math.floor(i / 10) * 2.4);
    res.setMatrixAt(i, m);
  }
  gParts.add(res);
}

/* --- the die ------------------------------------------------------------- */

const DIE_Y = TOP + 2.4 + 0.9;

const logo = await new Promise((res) => {
  const img = new Image();
  img.onload = () => res(img);
  img.onerror = () => res(null);
  img.src = "media/acm-logo-200.png";
});

{
  const plate = new THREE.Mesh(new THREE.BoxGeometry(24, 1.8, 24), matCeramic);
  plate.position.y = DIE_Y;
  gDie.add(plate);

  if (logo) {
    const face = new THREE.Mesh(
      new THREE.PlaneGeometry(19, 19),
      new THREE.MeshStandardMaterial({
        map: keyedLogo(logo),
        transparent: true,
        roughness: 0.5,
        metalness: 0.1,
        emissive: new THREE.Color(0x9fd0ff),
        emissiveIntensity: 1.15,
        emissiveMap: keyedLogo(logo),
        depthWrite: false,
      })
    );
    face.rotation.x = -Math.PI / 2;
    face.position.y = DIE_Y + 0.92;
    gDie.add(face);
  }

  /* bond pads on the rim of the die */
  const pads = new THREE.InstancedMesh(new THREE.BoxGeometry(1.5, 0.3, 0.9), matSolder, 24);
  const m = new THREE.Matrix4();
  let k = 0;
  for (let i = 0; i < 6; i++) {
    const o = -8 + i * 3.2;
    for (const [px, pz] of [
      [o, -10.9],
      [o, 10.9],
      [-10.9, o],
      [10.9, o],
    ]) {
      m.makeTranslation(px, DIE_Y + 0.95, pz);
      pads.setMatrixAt(k++, m);
    }
  }
  gDie.add(pads);
}

/* ----------------------------------------------------------------- lights -- */

scene.add(new THREE.AmbientLight(0x1d3350, 1.5));

const key = new THREE.DirectionalLight(0xcfe4ff, 2.6);
key.position.set(-42, 96, 62);
scene.add(key);

const rim = new THREE.DirectionalLight(0x3280e7, 3.4);
rim.position.set(74, 34, -66);
scene.add(rim);

const fill = new THREE.DirectionalLight(0x0d2b4c, 1.6);
fill.position.set(18, -30, 44);
scene.add(fill);

/* a soft glow under the die so it reads as powered */
const dieGlow = new THREE.PointLight(0x4a9bff, 40, 46, 2);
dieGlow.position.set(0, DIE_Y + 5, 0);
gDie.add(dieGlow);

/* ------------------------------------------------------------ pass 1: rt -- */

const target = new THREE.WebGLRenderTarget(2, 2, {
  minFilter: THREE.LinearFilter,
  magFilter: THREE.LinearFilter,
  format: THREE.RGBAFormat,
  type: THREE.UnsignedByteType,
  depthBuffer: true,
  stencilBuffer: false,
});
target.texture.generateMipmaps = false;

/* --------------------------------------------------------- pass 2: pattern -- */

const atlas = buildAtlas();
const tiers = buildTiers();

const quadScene = new THREE.Scene();
const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

const patternMat = new THREE.ShaderMaterial({
  uniforms: {
    uScene: { value: target.texture },
    uGlyphAtlas: { value: atlas },
    uTierData: { value: tiers },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uPixelRatio: { value: 1 },
    uAspect: { value: 1 },

    uPatternScale: { value: 50 },
    uPatternRotation: { value: 0 },
    uPatternCellGap: { value: 0.14 },
    uPatternGlyphScale: { value: 0.98 },
    uPatternBrightness: { value: 1.75 },
    uPatternLevels: { value: 8 },
    uPatternGlyphVariation: { value: 0.04 },
    uPatternGlyphSeed: { value: 3.7 },
    uPatternStrokeWeight: { value: 0.85 },
    uPatternGapWeight: { value: 0.5 },
    uPatternGlyphSoftness: { value: 1.6 },
    uPatternTierDither: { value: 0.35 },

    uPatternIntro: { value: 0 },
    uPatternIntroEnabled: { value: 1 },
    uPatternIntroRadius: { value: 0.95 },
    uPatternIntroSpread: { value: 0.72 },
    uPatternIntroJitter: { value: 0.4 },
    uPatternIntroFade: { value: 0.3 },
    uPatternIntroScaleFrom: { value: 0.15 },
    uPatternIntroFlash: { value: 0.25 },
    uPatternIntroDirection: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4(position.xy, 0.0, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    precision highp float;

    uniform sampler2D uScene;
    uniform sampler2D uGlyphAtlas;
    uniform sampler2D uTierData;
    uniform vec2 uResolution;
    uniform float uPixelRatio;
    uniform float uAspect;

    uniform float uPatternScale;
    uniform float uPatternRotation;
    uniform float uPatternCellGap;
    uniform float uPatternGlyphScale;
    uniform float uPatternBrightness;
    uniform float uPatternLevels;
    uniform float uPatternGlyphVariation;
    uniform float uPatternGlyphSeed;
    uniform float uPatternStrokeWeight;
    uniform float uPatternGapWeight;
    uniform float uPatternGlyphSoftness;
    uniform float uPatternTierDither;
    uniform float uPatternIntro;
    uniform float uPatternIntroEnabled;
    uniform float uPatternIntroRadius;
    uniform float uPatternIntroSpread;
    uniform float uPatternIntroJitter;
    uniform float uPatternIntroFade;
    uniform float uPatternIntroScaleFrom;
    uniform float uPatternIntroFlash;
    uniform float uPatternIntroDirection;

    varying vec2 vUv;

    const float GLYPH_COUNT = 8.0;
    const float GLYPH_SLOT_SIZE = 128.0;
    const float GLYPH_SPREAD = 9.0;
    const float GLYPH_MIN_FEATURE = 0.06;
    const float TIER_COUNT = 8.0;

    vec4 shadeSceneAt(vec2 uv) {
      if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return vec4(0.0);
      return texture2D(uScene, uv);
    }

    vec4 patternHexGrid(vec2 point) {
      const vec2 spacing = vec2(1.0, 1.7320508075688772);
      vec4 centers = floor(vec4(point, point - vec2(0.5, 0.8660254037844386)) / vec4(spacing, spacing)) + 0.5;
      vec4 offsets = vec4(point - centers.xy * spacing, point - (centers.zw + 0.5) * spacing);

      return dot(offsets.xy, offsets.xy) < dot(offsets.zw, offsets.zw)
        ? vec4(offsets.xy, centers.xy)
        : vec4(offsets.zw, centers.zw + 0.5);
    }

    float patternCellNoise(vec2 cellId, float salt) {
      return fract(sin(dot(cellId, vec2(63.31, 17.77)) + salt) * 9631.23);
    }

    float sdPatternHexagon(vec2 point, float radius) {
      point = abs(point);
      return max(dot(point, vec2(0.5, 0.8660254037844386)), point.x) - radius;
    }

    void main() {
      vec2 uv = vUv;

      float scale = max(uPatternScale, 4.0);
      float cosAngle = cos(uPatternRotation);
      float sinAngle = sin(uPatternRotation);
      mat2 rotation = mat2(cosAngle, -sinAngle, sinAngle, cosAngle);
      mat2 inverseRotation = mat2(cosAngle, sinAngle, -sinAngle, cosAngle);

      /* cells are square on screen whatever the stage's aspect is */
      vec2 centred = (uv - 0.5) * vec2(uAspect, 1.0) * 2.0;
      vec2 rotated = rotation * centred * scale;
      vec4 hexData = patternHexGrid(rotated);
      vec2 cellLocal = hexData.xy;
      vec2 cellId = hexData.zw;
      vec2 cellCentreUv = inverseRotation * ((rotated - cellLocal) / scale) / vec2(uAspect, 1.0) * 0.5 + 0.5;

      vec4 cellSample = shadeSceneAt(cellCentreUv);
      if (cellSample.a < 0.35) {
        gl_FragColor = vec4(0.0);
        return;
      }

      float minDimension = min(uResolution.x, uResolution.y);
      float pixelSize = 1.6 / (scale * max(minDimension, 10.0) * 0.5);

      float cellRadius = 0.5 - uPatternCellGap * 0.5;
      float cellDistance = sdPatternHexagon(cellLocal, cellRadius);
      float insideCell = uPatternCellGap > 0.001
        ? smoothstep(pixelSize, -pixelSize, cellDistance)
        : 1.0;

      float luminance = dot(cellSample.rgb, vec3(0.299, 0.587, 0.114));
      luminance = pow(clamp(luminance * uPatternBrightness, 0.0, 1.0), 1.25);

      /* Quantise, but give every cell its own offset first, so a flat face
         does not flip from one tier to the next in a single frame. */
      float levels = max(uPatternLevels, 2.0);
      float dither = (patternCellNoise(cellId, uPatternGlyphSeed * 11.7) - 0.5) * uPatternTierDither / levels;
      float tier = clamp(floor((luminance + dither) * levels), 0.0, levels - 1.0);

      vec4 tierData = texture2D(uTierData, vec2((tier + 0.5) / TIER_COUNT, 0.5));
      vec3 cellColor = tierData.rgb;
      float glyphIndex = floor(tierData.a * 255.0 + 0.5);

      /* a share of cells borrow another glyph, so the field never bands */
      if (uPatternGlyphVariation > 0.001) {
        float selector = fract(sin(dot(cellId, vec2(12.9898, 78.233)) + uPatternGlyphSeed * 17.13) * 43758.5453);
        if (selector < uPatternGlyphVariation) {
          float variant = fract(sin(dot(cellId, vec2(93.9898, 67.345)) + uPatternGlyphSeed * 31.41) * 23421.631);
          float variantTier = min(floor(variant * levels), levels - 1.0);
          vec4 variantData = texture2D(uTierData, vec2((variantTier + 0.5) / TIER_COUNT, 0.5));
          glyphIndex = floor(variantData.a * 255.0 + 0.5);
        }
      }

      /* Reveal: cells arrive in order of distance from the centre, each fading
         over uPatternIntroFade, so progress 1 has every cell fully in. */
      float reveal = 1.0;
      if (uPatternIntroEnabled > 0.5 && uPatternIntro < 0.999) {
        float radial = clamp(length(cellCentreUv - 0.5) / max(uPatternIntroRadius, 0.001), 0.0, 1.0);
        radial = mix(radial, 1.0 - radial, uPatternIntroDirection);
        float jitter = patternCellNoise(cellId, uPatternGlyphSeed * 7.31 + 3.0) * uPatternIntroJitter;
        float start = (radial + jitter) / (1.0 + uPatternIntroJitter) * uPatternIntroSpread;
        float fade = max(uPatternIntroFade, 0.001);
        reveal = clamp((uPatternIntro * (uPatternIntroSpread + fade) - start) / fade, 0.0, 1.0);
      }

      float revealEase = reveal * (2.0 - reveal);
      float tierSize = 0.66 + 0.34 * (tier / (levels - 1.0));
      float glyphSize = max(uPatternGlyphScale, 0.02) * tierSize * max(mix(uPatternIntroScaleFrom, 1.0, revealEase), 0.001);
      vec2 glyphUv = cellLocal / glyphSize + 0.5;

      float glyphMask = 0.0;

      if (glyphUv.x >= 0.0 && glyphUv.x <= 1.0 && glyphUv.y >= 0.0 && glyphUv.y <= 1.0) {
        float slotWidth = 1.0 / GLYPH_COUNT;
        vec2 atlasUv = vec2((glyphIndex + glyphUv.x) * slotWidth, 1.0 - glyphUv.y);

        float cellPixels = max(uResolution.y * 0.5 / scale, 1.0);
        float glyphPixels = max(cellPixels * uPixelRatio * glyphSize, 1.0);
        float pixelDistance = 1.0 / (glyphPixels * 2.0 * GLYPH_SPREAD);
        float featurePixels = GLYPH_MIN_FEATURE * glyphPixels;
        float bold = glyphIndex >= 6.0
          ? -max(uPatternGapWeight - featurePixels, 0.0)
          : max(uPatternStrokeWeight - featurePixels, 0.0);
        float softness = max(uPatternGlyphSoftness, 0.05) * 0.5 * pixelDistance;
        float edge = 0.5 - bold * 0.5 * pixelDistance;

        float signedDistance = texture2D(uGlyphAtlas, atlasUv).a;
        glyphMask = smoothstep(edge - softness, edge + softness, signedDistance);

        /* a halo just outside the stroke: the bright cells bloom */
        float halo = smoothstep(edge - 0.11, edge, signedDistance) - glyphMask;
        glyphMask += clamp(halo, 0.0, 1.0) * 0.28;

        glyphMask *= smoothstep(1.0, 0.96, glyphUv.x) * smoothstep(0.0, 0.04, glyphUv.x);
        glyphMask *= smoothstep(1.0, 0.96, glyphUv.y) * smoothstep(0.0, 0.04, glyphUv.y);
      }

      glyphMask *= smoothstep(pixelSize * 2.0, -pixelSize * 2.0, cellDistance + 0.01);

      float flash = 1.0 + uPatternIntroFlash * reveal * (1.0 - reveal) * 4.0;
      float alpha = glyphMask * insideCell * smoothstep(0.0, 0.7, reveal);

      /* premultiplied: the glyphs sit on a transparent stage, over the page */
      gl_FragColor = vec4(cellColor * flash * alpha, alpha);
    }
  `,
  transparent: true,
  depthTest: false,
  depthWrite: false,
  blending: THREE.CustomBlending,
  blendSrc: THREE.OneFactor,
  blendDst: THREE.OneMinusSrcAlphaFactor,
  blendSrcAlpha: THREE.OneFactor,
  blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
});

quadScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), patternMat));

/* ------------------------------------------------------------- behaviour -- */

let progress = reduced ? 1 : 0;
let shown = progress;

const dieBaseY = DIE_Y;
const partsBaseY = 0;

function readProgress() {
  if (!hero) return 1;
  const r = hero.getBoundingClientRect();
  const range = hero.offsetHeight - window.innerHeight;
  return range > 40 ? clamp(-r.top / range, 0, 1) : 1;
}

const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
window.addEventListener(
  "pointermove",
  (e) => {
    pointer.tx = (e.clientX / window.innerWidth - 0.5) * 2;
    pointer.ty = (e.clientY / window.innerHeight - 0.5) * 2;
  },
  { passive: true }
);

/* the framing: the board sits in the lower half of the stage, whole, and the
   camera swings a little as the layers come together */
const FOV = 26;

let framed = { dist: 280, targetY: 0, visH: 130 };

function measure() {
  const aspect = width / height;
  const wide = aspect > 1.3;

  /* a short viewport leaves little room under the copy, so the machine is
     drawn smaller rather than growing into the headline */
  const short = wide && height < 780;

  const widthFrac = wide ? (short ? 0.44 : 0.6) : 0.98;
  const fy = wide ? (short ? 0.8 : 0.71) : 0.5;

  /* visible world width that puts the board at widthFrac of the stage */
  const visW = BOARD_W / widthFrac;
  const visH = visW / aspect;
  const dist = visH / (2 * Math.tan((FOV * Math.PI) / 360));

  /* looking slightly above the board drops it down the frame */
  framed = { dist, targetY: (fy - 0.5) * visH, visH };

  camera.fov = FOV;
  camera.aspect = aspect;
  camera.updateProjectionMatrix();
}

function aim(p) {
  const e = easeOut(clamp(p, 0, 1));
  const azimuth = lerp(-0.42, -0.16, e);
  const elevation = lerp(0.98, 0.76, e);

  const dir = new THREE.Vector3(
    Math.sin(azimuth) * Math.cos(elevation),
    Math.sin(elevation),
    Math.cos(azimuth) * Math.cos(elevation)
  ).normalize();

  /* at rest the stack sits a little higher, so it clears the fold */
  const target = new THREE.Vector3(0, framed.targetY - (1 - e) * framed.visH * 0.05, 0);
  camera.position.copy(target).addScaledVector(dir, framed.dist);
  camera.lookAt(target);
}

function layout(p) {
  const e = easeOut(clamp(p, 0, 1));
  const gap = (1 - e) * GAP;

  gBoard.position.set(0, -1.0 * gap, 0.35 * gap);
  gCopper.position.set(0, -0.15 * gap, 0.12 * gap);
  gParts.position.set(0, 0.4 * gap, -0.15 * gap);
  gDie.position.set(0, 1.1 * gap, -0.4 * gap);

  stack.scale.setScalar(0.7 + 0.3 * e);
  stack.position.y = 0;

  aim(p);
  stack.position.z = 0;

  matCopper.emissiveIntensity = 1.0 + 0.15 * e;
  matSolder.emissiveIntensity = 0.78 + 0.12 * e;
  dieGlow.intensity = 40 + 10 * e;
}

/* --------------------------------------------------------------- render --- */

let width = 1;
let height = 1;
let dpr = 1;

function resize() {
  const r = canvas.getBoundingClientRect();
  width = Math.max(1, Math.round(r.width));
  height = Math.max(1, Math.round(r.height));
  dpr = Math.min(window.devicePixelRatio || 1, 1.75);

  renderer.setPixelRatio(dpr);
  renderer.setSize(width, height, false);

  const rtScale = Math.min(dpr, 1.5);
  target.setSize(Math.max(2, Math.round(width * rtScale)), Math.max(2, Math.round(height * rtScale)));

  patternMat.uniforms.uResolution.value.set(width, height);
  patternMat.uniforms.uPixelRatio.value = dpr;
  patternMat.uniforms.uAspect.value = width / height;

  measure();
  aim(shown);
}

function draw() {
  renderer.setRenderTarget(target);
  renderer.setClearAlpha(0);
  renderer.clear(true, true, false);
  renderer.render(scene, camera);

  renderer.setRenderTarget(null);
  renderer.clear(true, true, false);
  renderer.render(quadScene, quadCamera);
}

let raf = 0;
let running = false;
const clock = new THREE.Clock();
let t = 0;
let intro = reduced ? 1 : 0;

function frame() {
  raf = requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05);
  t += dt;

  if (intro < 1) {
    intro = Math.min(1, intro + dt / 1.7);
    patternMat.uniforms.uPatternIntro.value = easeOut(intro);
  }

  if (!reduced) {
    progress = readProgress();
    shown += (progress - shown) * Math.min(1, dt * 4.5);
    if (Math.abs(progress - shown) < 0.0005) shown = progress;
    layout(shown);

    pointer.x += (pointer.tx - pointer.x) * Math.min(1, dt * 2.6);
    pointer.y += (pointer.ty - pointer.y) * Math.min(1, dt * 2.6);

    stack.rotation.y = pointer.x * 0.07;
    stack.rotation.x = -0.02 + pointer.y * 0.03;

    /* a slow breath, so the field is never quite still */
    patternMat.uniforms.uPatternGlyphSeed.value = 3.7 + Math.sin(t * 0.13) * 0.22;
  }

  draw();
}

function start() {
  if (running) return;
  running = true;
  clock.getDelta();
  frame();
}

function stop() {
  running = false;
  cancelAnimationFrame(raf);
  raf = 0;
}

resize();
new ResizeObserver(() => {
  resize();
  draw();
}).observe(canvas.parentElement);

if ("IntersectionObserver" in window) {
  new IntersectionObserver(
    (entries) => {
      if (reduced) return;
      entries[0].isIntersecting ? start() : stop();
    },
    { threshold: 0 }
  ).observe(hero || canvas);
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) stop();
  else if (!reduced) start();
});

if (reduced) {
  layout(1);
  patternMat.uniforms.uPatternIntro.value = 1;
  draw();
} else {
  layout(0);
  start();
}

/* the poster renderer, and a handle for the QA harness */
window.__stage = {
  scene,
  camera,
  renderer,
  layout,
  THREE,
  stack,
  layers: { gBoard, gCopper, gParts, gDie },
  draw,
  target,
  setProgress(p) {
    layout(p);
    draw();
  },
  snap(mime = "image/jpeg", quality = 0.9, scale = 1) {
    const k = Math.max(1, scale);
    const w = Math.round(width * k);
    const h = Math.round(height * k);
    const out = document.createElement("canvas");
    out.width = w;
    out.height = h;
    const g = out.getContext("2d");
    g.fillStyle = "#0e1116";
    g.fillRect(0, 0, w, h);
    const grd = g.createRadialGradient(w / 2, h * 0.88, 0, w / 2, h * 0.88, w * 0.7);
    grd.addColorStop(0, "rgba(50,128,231,0.16)");
    grd.addColorStop(1, "rgba(14,17,22,0)");
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
    g.drawImage(canvas, 0, 0, w, h);
    return out.toDataURL(mime, quality);
  },
};
