/* ==========================================================================
   The network page — a model, drawn as a model.

   Six layers, left to right, each one a framed column: a header with the layer's
   node count and activation, then its nodes stacked down the frame with their
   own tags. Every node in one column is wired to every node in the next, which
   is what makes the dense X-mesh between the frames; the whole graph is 100
   nodes and 1,636 edges.

   Two canvases, because two things want different tools. The wires are WebGL:
   one instanced draw call for every segment of every edge, coloured per edge
   from a pink / violet / blue palette, with a white shimmer riding each pulse.
   The structure on top — frames, headers, nodes, tags — is Canvas2D, because
   text in a tool made for a diagram should be actual text.

   A single band sweeps the layer axis: left to right on a forward pass, right to
   left when the gradient comes home. Nothing moves until you click.
   ========================================================================== */

const root = document.documentElement;
const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const canvas = document.querySelector("[data-net]");
const chrome = document.querySelector("[data-chrome]");

const gl = canvas
  ? canvas.getContext("webgl2", {
      antialias: false,
      alpha: true,
      premultipliedAlpha: true,
      powerPreference: "high-performance",
    })
  : null;

if (!gl) {
  root.classList.add("no-gl");
} else {
  boot(gl);
}

function boot(gl) {
  const c2d = chrome ? chrome.getContext("2d") : null;

  /* ------------------------------------------------------------ the model -- */

  /* The drawing is the model, so these numbers are the ones printed in the
     summary below it: 14 + 18 + 22 + 22 + 18 + 6 nodes, and every possible
     connection between one column and the next. */
  const LAYERS = [
    { title: "Features", short: "X", prefix: "X", n: 14, act: "raw" },
    { title: "Hidden 1", short: "H1", prefix: "A", n: 18, act: "ReLU" },
    { title: "Hidden 2", short: "H2", prefix: "B", n: 22, act: "ReLU" },
    { title: "Hidden 3", short: "H3", prefix: "C", n: 22, act: "tanh" },
    { title: "Hidden 4", short: "H4", prefix: "D", n: 18, act: "ReLU" },
    { title: "Output", short: "O", prefix: "O", n: 6, act: "softmax" },
  ];

  const SPACING = 0.6; /* graph units between column centres */
  const ROW = 0.044; /* graph units between nodes in a column */
  const PANEL_HALF = 0.175; /* half a column's width, for fitting the drawing */
  const WIN_X = 2.06; /* a phone shows this much of the drawing's width */

  const nodes = [];
  const layers = [];

  LAYERS.forEach((cfg, i) => {
    const span = (cfg.n - 1) * ROW;
    const L = {
      ...cfg,
      index: i,
      x: (i - (LAYERS.length - 1) / 2) * SPACING,
      span,
      start: nodes.length,
    };
    layers.push(L);

    for (let k = 0; k < cfg.n; k++) {
      nodes.push({
        x: L.x,
        y: -span / 2 + k * ROW,
        layer: i,
        tag: cfg.prefix + (k + 1),
        seed: (i * 131 + k * 17) % 97,
      });
    }
  });

  /* No frames, no cards: six columns of nodes and the wires between them, the
     way a network is actually drawn. The only structure on top is a caption
     over each column. */
  const MAXSPAN = Math.max(...layers.map((L) => L.span));
  /* one caption line, above every wire in the drawing — wires fan up to the
     tallest column, so the row has to clear that, not each column's own top */
  const CAPTION_Y0 = -MAXSPAN / 2 - 0.115;
  let CAPTION_Y = CAPTION_Y0;
  /* from the caption line down to the last node: what the field has to hold */
  const GY = MAXSPAN / 2 - CAPTION_Y;

  for (const L of layers) {
    L.top = -MAXSPAN / 2;
    L.bottom = MAXSPAN / 2;
  }

  /* centre the drawing's real extent — the captions above, the last node
     below — rather than its origin */
  const CY = (CAPTION_Y + MAXSPAN / 2) / 2;

  for (const L of layers) {
    L.top -= CY;
    L.bottom -= CY;
  }
  for (const n of nodes) n.y -= CY;
  CAPTION_Y -= CY;

  const edges = [];
  for (let i = 0; i < layers.length - 1; i++) {
    const a = layers[i];
    const b = layers[i + 1];
    for (let p = 0; p < a.n; p++) {
      for (let q = 0; q < b.n; q++) {
        edges.push([a.start + p, b.start + q]);
      }
    }
  }

  /* each edge is a polyline of SEG pieces; one instance per piece */
  const SEG = 3;
  const inst = new Float32Array(edges.length * SEG * 7);
  let o = 0;

  for (let e = 0; e < edges.length; e++) {
    const A = nodes[edges[e][0]];
    const B = nodes[edges[e][1]];

    /* almost straight: the mesh has to read as connections, not as wire art.
       A hair of bow keeps a stack of edges from collapsing into one line. */
    const bow = (((e * 2654435761) % 1000) / 1000 - 0.5) * 0.012;

    let px = A.x;
    let py = A.y;

    for (let s = 0; s < SEG; s++) {
      const t = (s + 1) / SEG;
      const m = 1 - t;
      const qx = A.x + (B.x - A.x) * t;
      const qy = A.y + (B.y - A.y) * t + Math.sin(Math.PI * t) * bow;

      inst[o++] = px;
      inst[o++] = py;
      inst[o++] = qx;
      inst[o++] = qy;
      inst[o++] = s / SEG;
      inst[o++] = t;
      inst[o++] = e;

      px = qx;
      py = qy;
    }
  }

  /* --------------------------------------------------------------- shaders -- */

  const VS_EDGE = `#version 300 es
in vec2 aCorner;
in vec2 aP0;
in vec2 aP1;
in vec2 aU;
in float aId;

uniform vec2 uRes;
uniform float uT;
uniform float uZoom;
uniform vec2 uPar;
uniform float uBandP;
uniform float uBandA;
uniform float uMode;

out float vU;
out float vSide;
out float vId;
out float vT;

float h1(float n) { return fract(sin(n * 127.1) * 43758.5453); }

/* Continuous displacement: neighbouring segments share the point they meet at,
   so a polyline stays joined however far it drifts. Kept small - a diagram
   should breathe, not dissolve. */
vec2 warp(vec2 p) {
  float t = uT * 0.21;
  p += vec2(sin(p.y * 3.3 + t * 1.7), cos(p.x * 2.9 - t * 1.3)) * 0.013;
  p += vec2(sin(p.y * 8.2 - t * 2.3), cos(p.x * 7.1 + t * 1.9)) * 0.0045;
  p += vec2(sin(p.y * 15.7 + t * 3.1), cos(p.x * 13.3 - t * 2.7)) * 0.0016;
  return p;
}

void main() {
  vU = mix(aU.x, aU.y, aCorner.x);
  vSide = aCorner.y;
  vId = aId;
  vT = uT;

  float a = h1(aId);
  float b = h1(aId + 37.1);

  float u = uMode > 0.5 ? 1.0 - vU : vU;
  float speed = 0.09 + 0.22 * b;
  float head = fract(uT * speed + a * 3.0);
  float d = abs(u - head);
  d = min(d, 1.0 - d);
  float pulse = exp(-d * d * 900.0);
  float head2 = fract(uT * speed * 1.61 + a * 5.0 + 0.37);
  float d2 = abs(u - head2);
  d2 = min(d2, 1.0 - d2);
  pulse += 0.4 * exp(-d2 * d2 * 1400.0);

  vec2 p0 = warp(aP0);
  vec2 p1 = warp(aP1);

  vec2 ctr = uRes * 0.5 + uPar;
  vec2 s0 = ctr + p0 * uZoom;
  vec2 s1 = ctr + p1 * uZoom;

  vec2 dsv = s1 - s0;
  float len = max(length(dsv), 1e-4);
  vec2 nrm = vec2(-dsv.y, dsv.x) / len;

  /* the quad has to be wide enough to hold the halo the fragment shader
     lights, so the same pulse is computed here just to size it */
  float halfW = 0.5 + 0.45 * h1(aId + 5.0) + 3.4 * min(pulse, 1.1);

  vec2 pos = mix(s0, s1, aCorner.x) + nrm * aCorner.y * halfW;
  gl_Position = vec4(pos / uRes * 2.0 - 1.0, 0.0, 1.0);
}`;

  const FS_EDGE = `#version 300 es
precision highp float;

in float vU;
in float vSide;
in float vId;
in float vT;

uniform vec3 uBase;
uniform vec3 uHueA;
uniform vec3 uHueB;
uniform vec3 uHueC;
uniform vec3 uBackA;
uniform vec3 uBackB;
uniform float uAlpha;
uniform float uLive;
uniform float uMode;
uniform float uStill;

out vec4 o;

float h1(float n) { return fract(sin(n * 127.1) * 43758.5453); }

void main() {
  float a = h1(vId);
  float b = h1(vId + 37.1);
  float c = h1(vId + 211.7);

  /* attention: a slow per-edge weight, cubed so a few wires carry most of it */
  float att = pow(0.5 + 0.5 * sin(vT * 0.33 + c * 6.2831), 3.0);

  float u = vU;
  float speed = 0.09 + 0.22 * b;
  float head = fract(vT * speed + a * 3.0);
  float d = abs(u - head);
  d = min(d, 1.0 - d);
  float pulse = exp(-d * d * 900.0);

  float head2 = fract(vT * speed * 1.61 + a * 5.0 + 0.37);
  float d2 = abs(u - head2);
  d2 = min(d2, 1.0 - d2);
  pulse += 0.4 * exp(-d2 * d2 * 1400.0);

  /* One hue per wire, fixed for the life of the page: the mesh is blue, violet
     and pink at once, the way a weight matrix looks when it is lit. Which of
     the three is decided per edge, so the same wire keeps its colour. */
  float k = mod(vId, 3.0);
  vec3 hue = k < 1.0 ? uHueA : (k < 2.0 ? uHueB : uHueC);

  /* Coming home, the whole field turns over to pink and violet. */
  vec3 back = mix(uBackA, uBackB, clamp(k * 0.5, 0.0, 1.0));
  hue = mix(hue, back, uMode);

  float glow = pulse * (0.18 + 0.82 * att) * uLive * mix(1.0, 0.45, uStill);

  /* at rest a wire still keeps most of its own hue, so the mesh is never one
     colour even when nothing is moving */
  vec3 col = mix(uBase, hue, 0.62 + 0.38 * clamp(glow, 0.0, 1.0));

  /* the head of every pulse burns white; the tail keeps its hue. A still frame
     keeps the lit mesh but not the travelling heads, so nothing looks frozen
     mid-flight. */
  float shimmer = pow(clamp(pulse, 0.0, 1.0), 1.6) * uLive * (1.0 - uStill);
  col = mix(col, vec3(1.0), clamp(shimmer * 0.85, 0.0, 1.0));

  float w = 1.0 - abs(vSide);
  float core = smoothstep(0.12, 0.75, w);
  float halo = pow(max(w, 0.0), 1.6);

  float alpha = clamp(
    uAlpha * (0.09 + 0.30 * att) * core +
    0.6 * min(glow, 1.2) * halo,
    0.0,
    1.0
  );

  o = vec4(col * alpha, alpha);
}`;

  function program(vs, fs) {
    const p = gl.createProgram();
    for (const [type, src] of [
      [gl.VERTEX_SHADER, vs],
      [gl.FRAGMENT_SHADER, fs],
    ]) {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(sh));
      gl.attachShader(p, sh);
    }
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) console.error(gl.getProgramInfoLog(p));

    const u = {};
    for (let i = 0, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); i < n; i++) {
      const name = gl.getActiveUniform(p, i).name;
      u[name] = gl.getUniformLocation(p, name);
    }
    return { p, u, a: (name) => gl.getAttribLocation(p, name) };
  }

  const PE = program(VS_EDGE, FS_EDGE);

  const cornerBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, cornerBuf);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([0, -1, 1, -1, 0, 1, 0, 1, 1, -1, 1, 1]),
    gl.STATIC_DRAW
  );

  const instBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
  gl.bufferData(gl.ARRAY_BUFFER, inst, gl.STATIC_DRAW);

  const instCount = edges.length * SEG;

  /* ------------------------------------------------------------ the palette -- */

  /* Paper is the same drawing printed on white: the hues go darker and the
     blend goes normal, because additive light on paper is just a smudge. */
  const PAL = {
    ink: {
      base: [0.40, 0.46, 0.72],
      hueA: [0.30, 0.62, 1.0],
      hueB: [0.62, 0.42, 1.0],
      hueC: [1.0, 0.38, 0.78],
      backA: [1.0, 0.32, 0.58],
      backB: [0.72, 0.34, 1.0],
      alpha: 0.9,
      additive: true,
      title: "#e2eaff",
      meta: "#93a4c6",
      node: "#f4f8ff",
      tag: "#a7b8d8",
      grid: "rgba(126, 166, 255, 0.06)",
      halo: "rgba(6, 8, 13, 0.9)",
    },
    paper: {
      base: [0.34, 0.40, 0.58],
      hueA: [0.16, 0.38, 0.88],
      hueB: [0.46, 0.22, 0.84],
      hueC: [0.86, 0.18, 0.5],
      backA: [0.88, 0.16, 0.36],
      backB: [0.62, 0.2, 0.78],
      alpha: 4.0,
      additive: false,
      title: "#0b0f14",
      meta: "#6b7889",
      node: "#101823",
      tag: "#22304a",
      grid: "rgba(11, 15, 20, 0.05)",
      halo: "rgba(255, 255, 255, 0.92)",
    },
  };

  const themeName = () => (root.classList.contains("ink") ? "ink" : "paper");

  function applyBlend() {
    if (PAL[themeName()].additive) gl.blendFunc(gl.ONE, gl.ONE);
    else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    if (c2d) c2d.clearRect(0, 0, chrome.width, chrome.height);
  }

  gl.enable(gl.BLEND);
  gl.clearColor(0, 0, 0, 0);

  /* --------------------------------------------------------------- sizing -- */

  let W = 2;
  let H = 2;
  let CW = 2;
  let CH = 2;
  let dprNow = 1;
  let zoom = 300; /* device px per graph unit */
  let zoomCss = 150;

  /* the graph's own extent, for fitting it to any window */
  const GX = (LAYERS.length - 1) * SPACING + PANEL_HALF * 2;

  function resize() {
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    dprNow = dpr;

    CW = Math.max(2, Math.round(r.width));
    CH = Math.max(2, Math.round(r.height));
    W = Math.max(2, Math.round(CW * dpr));
    H = Math.max(2, Math.round(CH * dpr));

    if (canvas.width !== W) canvas.width = W;
    if (canvas.height !== H) canvas.height = H;
    gl.viewport(0, 0, W, H);

    if (chrome) {
      if (chrome.width !== W) chrome.width = W;
      if (chrome.height !== H) chrome.height = H;
    }

    /* The field is a wide band, so the fit is led by the height: the drawing
       has to sit inside it with air above and below, and still reach the
       sides. A phone cannot hold six columns at a legible size, so it holds a
       window across the middle of the same drawing instead, and the network
       runs off both edges. */
    if (CW < 720) {
      zoom = Math.min(W / (WIN_X * 1), H / (GY * 1.06));
    } else {
      const padX = 1.06;
      const padY = 1.12;
      zoom = Math.min(W / (GX * padX), H / (GY * padY));
    }
    zoomCss = zoom / dpr;
  }

  /* ---------------------------------------------------------------- state -- */

  let XMIN = 0;
  let XMAX = 0;
  for (const L of layers) {
    XMIN = Math.min(XMIN, L.x - PANEL_HALF);
    XMAX = Math.max(XMAX, L.x + PANEL_HALF);
  }

  let t = 0;
  let last = 0;
  let raf = 0;
  let running = false;

  let mode = 0;
  let run = null;

  let bandP = XMIN;
  let bandA = 0;
  let live = 0.3;

  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };

  const hud = document.querySelector(".nethero__hud");
  const hudMode = document.querySelector("[data-hud-mode]");
  const hudCount = document.querySelector("[data-hud-count]");

  if (hudCount) hudCount.textContent = edges.length.toLocaleString("en-IN") + " edges";

  function setMode(next) {
    mode = next;
    if (hud) hud.dataset.mode = run ? (next ? "back" : "fwd") : "rest";
    if (hudMode) {
      hudMode.textContent = !run ? "at rest" : next ? "backward pass" : "forward pass";
    }
  }

  function fire() {
    /* one click is one whole pass: out through every layer, then the gradient
       home along the same wires */
    run = { dir: 0, t: 0, hold: 0 };
    setMode(0);
  }

  /* --------------------------------------------------------------- inputs -- */

  window.addEventListener(
    "pointermove",
    (e) => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      pointer.tx = (e.clientX / window.innerWidth - 0.5) * 26 * dpr;
      pointer.ty = (e.clientY / window.innerHeight - 0.5) * 18 * dpr;
    },
    { passive: true }
  );

  const hero = document.querySelector(".nethero");
  if (hero && !reduced) {
    hero.addEventListener("pointerdown", (e) => {
      if (e.target.closest("a, button")) return;
      fire();
    });
  }

  const fireBtn = document.querySelector("[data-fire]");
  if (fireBtn && !reduced) fireBtn.addEventListener("click", () => fire());

  /* ---------------------------------------------------------------- render -- */

  /* the same displacement as the shader, in JS, so a node sits exactly where its
     wires meet it */
  function warpJS(x, y, tt) {
    const tm = tt * 0.21;
    x += Math.sin(y * 3.3 + tm * 1.7) * 0.013;
    y += Math.cos(x * 2.9 - tm * 1.3) * 0.013;
    x += Math.sin(y * 8.2 - tm * 2.3) * 0.0045;
    y += Math.cos(x * 7.1 + tm * 1.9) * 0.0045;
    x += Math.sin(y * 15.7 + tm * 3.1) * 0.0016;
    y += Math.cos(x * 13.3 - tm * 2.7) * 0.0016;
    return [x, y];
  }

  const MONO = '11px "Fira Mono", ui-monospace, "Cascadia Mono", Consolas, monospace';
  const MONO_SM = '9px "Fira Mono", ui-monospace, "Cascadia Mono", Consolas, monospace';

  function drawChrome(tt) {
    if (!c2d) return;

    const pal = PAL[themeName()];
    const cx = CW / 2 + pointer.x / dprNow;
    const cy = CH / 2 + pointer.y / dprNow;
    const row = ROW * zoomCss;
    const showTags = row >= 12;
    const showMeta = CW > 760;

    c2d.setTransform(dprNow, 0, 0, dprNow, 0, 0);
    c2d.clearRect(0, 0, CW, CH);

    const px = (gx) => cx + gx * zoomCss;
    const py = (gy) => cy + gy * zoomCss;

    /* --- the grid the model sits on ------------------------------------- */
    c2d.strokeStyle = pal.grid;
    c2d.lineWidth = 1;
    c2d.beginPath();
    for (let gx = -1.8; gx <= 1.801; gx += 0.2725) {
      c2d.moveTo(px(gx), 0);
      c2d.lineTo(px(gx), CH);
    }
    for (let gy = -0.9; gy <= 0.901; gy += 0.15) {
      c2d.moveTo(0, py(gy));
      c2d.lineTo(CW, py(gy));
    }
    c2d.stroke();

    /* --- one caption per column ----------------------------------------- */
    c2d.textAlign = "center";
    c2d.textBaseline = "alphabetic";
    /* the caption line sits above the wires, but a halo keeps it crisp: drawn
       twice, once for the halo and once for the ink */
    c2d.shadowColor = pal.halo;
    c2d.shadowBlur = 8;

    for (let pass = 0; pass < 2; pass++) {
      for (const L of layers) {
        const x = px(L.x);

        c2d.fillStyle = pal.title;
        c2d.font = showMeta ? MONO : MONO_SM;
        c2d.fillText(showMeta ? L.title : L.short, x, py(CAPTION_Y));

        if (showMeta) {
          c2d.fillStyle = pal.meta;
          c2d.font = MONO_SM;
          c2d.fillText(L.n + " · " + L.act, x, py(CAPTION_Y) + 14);
        }
      }
      c2d.shadowBlur = 0;
    }

    /* --- nodes and their tags -------------------------------------------- */
    /* the dot never grows into its neighbours: it is bounded by the row pitch
       as well as by the zoom, so a narrow field keeps six clean columns */
    const r = Math.max(1.2, Math.min(0.0135 * zoomCss, row * 0.26));

    for (const n of nodes) {
      const [wx, wy] = warpJS(n.x, n.y, tt);
      const sx = cx + wx * zoomCss;
      const sy = cy + wy * zoomCss;

      const L = layers[n.layer];
      /* the band lights the column it is crossing; the dot answers it */
      const band = bandA * Math.exp(-Math.pow((bandP - L.x) * 3.1, 2));
      const heat = Math.min(1, band * 1.4);

      c2d.beginPath();
      c2d.arc(sx, sy, r, 0, Math.PI * 2);
      c2d.fillStyle = heat > 0.05
        ? (mode ? "rgba(255, 176, 214, " : "rgba(198, 226, 255, ") + (0.7 + 0.3 * heat) + ")"
        : pal.node;
      c2d.fill();
    }

    /* The tags sit in the middle of the wire field, so they get a halo in the
       page's own colour instead of a plate — and, like the captions, they are
       painted twice: halo first, ink on top. */
    if (showTags) {
      c2d.font = MONO_SM;
      c2d.textAlign = "left";
      c2d.textBaseline = "middle";

      const spots = nodes.map((n) => {
        const [wx, wy] = warpJS(n.x, n.y, tt);
        return [cx + wx * zoomCss + r + 4, cy + wy * zoomCss + 0.5];
      });

      c2d.fillStyle = pal.tag;
      c2d.shadowColor = pal.halo;
      c2d.shadowBlur = 6;
      nodes.forEach((n, i) => c2d.fillText(n.tag, spots[i][0], spots[i][1]));

      c2d.shadowBlur = 0;
      nodes.forEach((n, i) => c2d.fillText(n.tag, spots[i][0], spots[i][1]));
    }

    c2d.shadowBlur = 0;
  }

  function draw(tt) {
    const pal = PAL[themeName()];

    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(PE.p);

    gl.bindBuffer(gl.ARRAY_BUFFER, cornerBuf);
    const aCorner = PE.a("aCorner");
    gl.enableVertexAttribArray(aCorner);
    gl.vertexAttribPointer(aCorner, 2, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(aCorner, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
    const STRIDE = 7 * 4;
    const attribs = [
      ["aP0", 2, 0],
      ["aP1", 2, 8],
      ["aU", 2, 16],
      ["aId", 1, 24],
    ];
    for (const [name, size, off] of attribs) {
      const loc = PE.a(name);
      if (loc < 0) continue;
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, STRIDE, off);
      gl.vertexAttribDivisor(loc, 1);
    }

    gl.uniform2f(PE.u.uRes, W, H);
    gl.uniform1f(PE.u.uT, tt);
    gl.uniform1f(PE.u.uZoom, zoom);
    gl.uniform2f(PE.u.uPar, pointer.x, pointer.y);
    gl.uniform3fv(PE.u.uBase, pal.base);
    gl.uniform3fv(PE.u.uHueA, pal.hueA);
    gl.uniform3fv(PE.u.uHueB, pal.hueB);
    gl.uniform3fv(PE.u.uHueC, pal.hueC);
    gl.uniform3fv(PE.u.uBackA, pal.backA);
    gl.uniform3fv(PE.u.uBackB, pal.backB);
    gl.uniform1f(PE.u.uBandP, bandP);
    gl.uniform1f(PE.u.uBandA, bandA);
    gl.uniform1f(PE.u.uMode, mode);
    gl.uniform1f(PE.u.uLive, live);
    gl.uniform1f(PE.u.uStill, reduced ? 1 : 0);
    gl.uniform1f(PE.u.uAlpha, pal.alpha);

    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, instCount);

    drawChrome(tt);
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (!last) last = now;
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;

    t += dt;

    if (run) {
      if (run.hold > 0) {
        run.hold -= dt;
        if (run.hold <= 0) {
          run.dir = 1;
          run.t = 0;
          setMode(1);
        }
      } else {
        run.t += dt / 1.9;
        if (run.t >= 1) {
          bandA = 0;
          if (run.dir === 0) run.hold = 0.6;
          else {
            run = null;
            setMode(0);
          }
        } else {
          bandP =
            run.dir === 0
              ? XMIN + (XMAX - XMIN) * run.t
              : XMAX - (XMAX - XMIN) * run.t;
          bandA = Math.sin(Math.PI * run.t);
        }
      }
    }

    pointer.x += (pointer.tx - pointer.x) * Math.min(1, dt * 2.4);
    pointer.y += (pointer.ty - pointer.y) * Math.min(1, dt * 2.4);

    live += ((run ? 1 : 0.3) - live) * Math.min(1, dt * 2.6);

    draw(t);
  }

  function start() {
    if (running || reduced) return;
    running = true;
    last = 0;
    frame(performance.now());
  }

  function stop() {
    running = false;
    cancelAnimationFrame(raf);
    raf = 0;
  }

  /* ------------------------------------------------------------- lifecycle -- */

  resize();
  new ResizeObserver(() => {
    resize();
    if (reduced) draw(6.4);
  }).observe(canvas.parentElement);

  setMode(0);
  applyBlend();

  if (reduced) {
    root.classList.add("still");
    draw(6.4);
  } else {
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(
        (entries) => (entries[0].isIntersecting ? start() : stop()),
        { threshold: 0 }
      ).observe(canvas.parentElement);
    } else {
      start();
    }
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) stop();
      else start();
    });
  }

  /* ---------------------------------------------------------------- theme -- */

  function syncTheme() {
    applyBlend();
    if (reduced) draw(6.4);
  }

  document.addEventListener("themechange", syncTheme);

  /* a handle for the QA harness */
  window.__net = {
    size: () => ({ w: W, h: H, zoom, edges: edges.length, nodes: nodes.length }),
    setMode: (m) => setMode(m),
    fire: () => fire(),
    settle(tt = 6.4) {
      stop();
      bandA = 0;
      bandP = XMIN;
      draw(tt);
    },
    pose(tt = 6.4, p = 0.5, a = 1) {
      stop();
      live = 1;
      bandP = p;
      bandA = a;
      draw(tt);
      return canvas.toDataURL("image/png");
    },
    snap(mime = "image/png", tt = 6.4) {
      stop();
      draw(tt);
      return canvas.toDataURL(mime);
    },
  };
}
