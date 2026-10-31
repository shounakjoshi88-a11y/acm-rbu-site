/* ==========================================================================
   The network page — a graph you can send a signal through.

   Built in raw WebGL2, same as the home page's mark: no three.js, no library.
   One instanced draw call for every segment of every edge, one for the nodes.

   The graph is fixed at load: seven layers, 208 nodes, 2,328 edges. Each edge
   is a cubic that bows off the straight line, and every vertex is displaced by
   a low-frequency function of its own position, so the wires breathe and drift
   without ever coming apart — the warp is continuous across shared endpoints.

   Two things travel those wires. Ambient pulses run forever, each edge at its
   own speed, and a per-edge attention weight decides how much of the signal
   that edge is allowed to carry. On top of that a single band sweeps the whole
   field: left to right on a forward pass, right to left when the direction
   reverses. Clicking sends one yourself.
   ========================================================================== */

const canvas = document.querySelector("[data-net]");
const root = document.documentElement;
const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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
  /* ------------------------------------------------------------ the graph -- */

  const WIDTHS = [14, 28, 40, 44, 40, 28, 14];
  const OUT = 12; /* edges leaving each node */
  const SEG = 6; /* straight pieces per edge */

  /* a seeded generator, so the graph is the same on every load */
  let seed = 20261031;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };

  const nodes = [];
  const layerStart = [];

  for (let L = 0; L < WIDTHS.length; L++) {
    layerStart.push(nodes.length);
    const w = WIDTHS[L];
    const t = L / (WIDTHS.length - 1);
    /* the middle of the stack is the widest, the ends taper */
    const spread = 0.44 + 0.56 * Math.sin(Math.PI * (0.16 + 0.68 * t));

    for (let j = 0; j < w; j++) {
      const f = w === 1 ? 0.5 : j / (w - 1);
      nodes.push({
        x: -1.35 + 2.7 * t + (rnd() - 0.5) * 0.07,
        y: (f - 0.5) * 2 * spread + (rnd() - 0.5) * 0.11,
        s: rnd(),
      });
    }
  }

  const edges = [];
  for (let L = 0; L < WIDTHS.length - 1; L++) {
    const a0 = layerStart[L];
    const b0 = layerStart[L + 1];
    const n1 = WIDTHS[L + 1];
    for (let i = 0; i < WIDTHS[L]; i++) {
      for (let k = 0; k < OUT; k++) {
        edges.push([a0 + i, b0 + Math.floor(rnd() * n1)]);
      }
    }
  }

  /* every edge, tessellated into segments. One instance per segment. */
  const inst = new Float32Array(edges.length * SEG * 7);
  let o = 0;

  for (let e = 0; e < edges.length; e++) {
    const A = nodes[edges[e][0]];
    const B = nodes[edges[e][1]];
    const dx = B.x - A.x;
    const dy = B.y - A.y;
    const len = Math.hypot(dx, dy) || 1e-4;

    /* the bow is what stops the wires reading as a wiring diagram. keep it
       shallow: past about a third of the span the silhouette turns into a comb */
    const bow = (rnd() - 0.5) * len * 0.24;
    const nx = -dy / len;
    const ny = dx / len;
    const c1x = A.x + dx * 0.33 + nx * bow;
    const c1y = A.y + dy * 0.33 + ny * bow;
    const c2x = A.x + dx * 0.67 + nx * bow;
    const c2y = A.y + dy * 0.67 + ny * bow;

    let px = A.x;
    let py = A.y;

    for (let s = 0; s < SEG; s++) {
      const t = (s + 1) / SEG;
      const m = 1 - t;
      const qx = m * m * m * A.x + 3 * m * m * t * c1x + 3 * m * t * t * c2x + t * t * t * B.x;
      const qy = m * m * m * A.y + 3 * m * m * t * c1y + 3 * m * t * t * c2y + t * t * t * B.y;

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

  const nodeData = new Float32Array(nodes.length * 3);
  for (let i = 0; i < nodes.length; i++) {
    nodeData[i * 3] = nodes[i].x;
    nodeData[i * 3 + 1] = nodes[i].y;
    nodeData[i * 3 + 2] = nodes[i].s;
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
uniform mat2 uRot;
uniform float uBandP;
uniform float uBandA;
uniform float uMode;

out float vU;
out float vSide;
out float vId;
out float vT;
out float vX;

float h1(float n) { return fract(sin(n * 127.1) * 43758.5453); }

/* a continuous displacement: adjacent segments share an endpoint, so the
   polyline stays joined no matter how far it drifts */
vec2 warp(vec2 p) {
  float t = uT * 0.21;
  p += vec2(sin(p.y * 3.3 + t * 1.7), cos(p.x * 2.9 - t * 1.3)) * 0.042;
  p += vec2(sin(p.y * 8.2 - t * 2.3), cos(p.x * 7.1 + t * 1.9)) * 0.012;
  p += vec2(sin(p.y * 15.7 + t * 3.1), cos(p.x * 13.3 - t * 2.7)) * 0.004;
  return p;
}

void main() {
  vU = mix(aU.x, aU.y, aCorner.x);
  vSide = aCorner.y;
  vId = aId;
  vT = uT;
  /* the layer axis, so the sweep is one wall of light crossing the graph
     rather than a separate flash travelling along every wire at once */
  vX = mix(aP0.x, aP1.x, vU);

  /* the ribbon has to be wide enough to hold a halo, so the same pulse the
     fragment shader lights is computed here to size the quad */
  float a = h1(aId);
  float b = h1(aId + 37.1);
  float c = h1(aId + 211.7);
  float att = pow(0.5 + 0.5 * sin(uT * 0.33 + c * 6.2831), 3.0);
  float u = uMode > 0.5 ? 1.0 - vU : vU;
  float speed = 0.10 + 0.26 * b;
  float head = fract(uT * speed + a * 3.0);
  float d = abs(u - head);
  d = min(d, 1.0 - d);
  float pulse = exp(-d * d * 420.0);
  float head2 = fract(uT * speed * 1.63 + a * 5.0 + 0.37);
  float d2 = abs(u - head2);
  d2 = min(d2, 1.0 - d2);
  pulse += 0.45 * exp(-d2 * d2 * 700.0);

  /* the burst: a wall of light crossing the graph, layer by layer, with a tail
     behind it so the direction of travel is legible. narrow on purpose - a wide
     band across two thousand edges goes white */
  float lag = uMode > 0.5 ? vX - uBandP : uBandP - vX;
  float band =
    (exp(-pow((vX - uBandP) * 3.4, 2.0)) +
     0.45 * step(0.0, lag) * exp(-pow(max(lag, 0.0) * 1.6, 2.0))) * uBandA;
  float attn = 0.25 + 0.75 * att;
  float glow = pulse * (0.15 + 0.85 * att);

  vec2 p0 = warp(uRot * aP0);
  vec2 p1 = warp(uRot * aP1);

  vec2 ctr = uRes * 0.5 + uPar;
  vec2 s0 = ctr + p0 * uZoom;
  vec2 s1 = ctr + p1 * uZoom;

  vec2 dsv = s1 - s0;
  float len = max(length(dsv), 1e-4);
  vec2 nrm = vec2(-dsv.y, dsv.x) / len;

  float h = h1(aId);
  float halfW = 0.45 + 0.6 * h * h + 4.2 * min(glow, 1.1) + 1.2 * band * attn;

  vec2 pos = mix(s0, s1, aCorner.x) + nrm * aCorner.y * halfW;
  gl_Position = vec4(pos / uRes * 2.0 - 1.0, 0.0, 1.0);
}`;

  const FS_EDGE = `#version 300 es
precision highp float;

in float vU;
in float vSide;
in float vId;
in float vT;
in float vX;

uniform vec3 uBase;
uniform vec3 uHot;
uniform vec3 uCold;
uniform float uBandP;
uniform float uBandA;
uniform float uMode;
uniform float uAlpha;
uniform float uLive;

out vec4 o;

float h1(float n) { return fract(sin(n * 127.1) * 43758.5453); }

void main() {
  float a = h1(vId);
  float b = h1(vId + 37.1);
  float c = h1(vId + 211.7);

  /* attention: a slow per-edge weight, cubed so a few wires dominate */
  float att = pow(0.5 + 0.5 * sin(vT * 0.33 + c * 6.2831), 3.0);

  float u = uMode > 0.5 ? 1.0 - vU : vU;

  float speed = 0.10 + 0.26 * b;
  float head = fract(vT * speed + a * 3.0);
  float d = abs(u - head);
  d = min(d, 1.0 - d);
  float pulse = exp(-d * d * 420.0);

  float head2 = fract(vT * speed * 1.63 + a * 5.0 + 0.37);
  float d2 = abs(u - head2);
  d2 = min(d2, 1.0 - d2);
  pulse += 0.45 * exp(-d2 * d2 * 700.0);

  /* the burst: one wall of light crossing the graph, layer by layer */
  float lag = uMode > 0.5 ? vX - uBandP : uBandP - vX;
  float band =
    (exp(-pow((vX - uBandP) * 3.4, 2.0)) +
     0.45 * step(0.0, lag) * exp(-pow(max(lag, 0.0) * 1.6, 2.0))) * uBandA;
  float attn = 0.25 + 0.75 * att;

  float glow = pulse * (0.15 + 0.85 * att) * uLive;
  vec3 hot = mix(uHot, uCold, uMode);
  vec3 col = mix(uBase, hot, clamp(glow * 1.15 + band * attn * 0.9, 0.0, 1.0));

  /* the quad is wide; the hairline is its core, the halo is its skirt */
  float w = 1.0 - abs(vSide);
  float core = smoothstep(0.10, 0.72, w);
  float halo = pow(max(w, 0.0), 1.7);

  float alpha = clamp(
    uAlpha * (0.05 + 0.20 * att) * core +
    min(glow, 1.2) * halo * 0.55 +
    band * attn * halo * 0.18,
    0.0,
    1.0
  );

  o = vec4(col * alpha, alpha);
}`;

  const VS_NODE = `#version 300 es
in vec2 aPos;
in float aSeed;

uniform vec2 uRes;
uniform float uZoom;
uniform vec2 uPar;
uniform mat2 uRot;
uniform float uT;
uniform float uDpr;

out float vSeed;

void main() {
  vSeed = aSeed;

  float t = uT * 0.21;
  vec2 p = uRot * aPos;
  p += vec2(sin(p.y * 3.3 + t * 1.7), cos(p.x * 2.9 - t * 1.3)) * 0.042;
  p += vec2(sin(p.y * 8.2 - t * 2.3), cos(p.x * 7.1 + t * 1.9)) * 0.012;
  p += vec2(sin(p.y * 15.7 + t * 3.1), cos(p.x * 13.3 - t * 2.7)) * 0.004;

  vec2 s = uRes * 0.5 + uPar + p * uZoom;
  gl_Position = vec4(s / uRes * 2.0 - 1.0, 0.0, 1.0);
  gl_PointSize = (3.0 + 3.4 * fract(aSeed * 7.31)) * uDpr;
}`;

  const FS_NODE = `#version 300 es
precision highp float;

in float vSeed;
uniform vec3 uNode;
out vec4 o;

void main() {
  vec2 g = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(g, g);
  if (r2 > 1.0) discard;
  float a = (1.0 - r2) * (0.34 + 0.46 * fract(vSeed * 3.71));
  o = vec4(uNode * a, a);
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
  const PN = program(VS_NODE, FS_NODE);

  /* -------------------------------------------------------------- buffers -- */

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

  const nodeBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, nodeBuf);
  gl.bufferData(gl.ARRAY_BUFFER, nodeData, gl.STATIC_DRAW);

  const nodeCount = nodes.length;
  const instCount = edges.length * SEG;

  /* ------------------------------------------------------------ the palette -- */

  const PAL = {
    ink: {
      base: [0.26, 0.40, 0.78],
      hot: [0.44, 0.80, 1.0],
      cold: [1.0, 0.66, 0.36],
      node: [0.62, 0.80, 1.0],
      alpha: 0.95,
      additive: true,
    },
    paper: {
      base: [0.50, 0.62, 0.86],
      hot: [0.10, 0.34, 0.92],
      cold: [0.88, 0.36, 0.10],
      node: [0.18, 0.40, 0.90],
      alpha: 0.85,
      additive: false,
    },
  };

  const themeName = () => (root.classList.contains("ink") ? "ink" : "paper");

  function applyBlend() {
    const pal = PAL[themeName()];
    if (pal.additive) gl.blendFunc(gl.ONE, gl.ONE);
    else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }

  gl.enable(gl.BLEND);
  applyBlend();
  gl.clearColor(0, 0, 0, 0);

  /* --------------------------------------------------------------- sizing -- */

  let W = 2;
  let H = 2;
  let zoom = 200;
  let dprNow = 1;
  let rot = new Float32Array([1, 0, 0, 1]);

  function resize() {
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    dprNow = dpr;

    W = Math.max(2, Math.round(r.width * dpr));
    H = Math.max(2, Math.round(r.height * dpr));
    if (canvas.width !== W) canvas.width = W;
    if (canvas.height !== H) canvas.height = H;
    gl.viewport(0, 0, W, H);

    /* a phone gets the layers running top to bottom, not squeezed sideways */
    const portrait = W < H * 0.92;
    rot = portrait ? new Float32Array([0, 1, -1, 0]) : new Float32Array([1, 0, 0, 1]);
    zoom = portrait ? Math.min(W / 2.05, H / 3.0) : Math.min(W / 3.1, H / 2.3);
  }

  /* ---------------------------------------------------------------- state -- */

  const XMIN = -1.55;
  const XMAX = 1.55;
  let t = 0;
  let last = 0;
  let raf = 0;
  let running = false;

  let mode = 0; /* 0 forward, 1 backward */
  let run = null; /* { dir, t, from, hold } while a pass is in flight */

  let bandP = XMIN;
  let bandA = 0;
  let live = 0.34;

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

  function begin() {
    /* one click is one whole pass: forward out across every layer, then the
       gradient home. it always covers the full graph, so a click near the far
       edge is not a click that shows nothing */
    run = { dir: 0, t: 0, from: XMIN, hold: 0 };
    setMode(0);
  }

  /* --------------------------------------------------------------- inputs -- */

  window.addEventListener(
    "pointermove",
    (e) => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      pointer.tx = (e.clientX / window.innerWidth - 0.5) * 30 * dpr;
      pointer.ty = (e.clientY / window.innerHeight - 0.5) * 20 * dpr;
    },
    { passive: true }
  );

  function fire(e) {
    if (e) {
      /* the wave leaves from where the pointer landed: convert the click to
         graph space, then project it onto the layer axis */
      const r = canvas.getBoundingClientRect();
      const nx = ((e.clientX - r.left) / r.width) * 2 - 1;
      const ny = 1 - ((e.clientY - r.top) / r.height) * 2;
      const gx = rot[0] * nx + rot[1] * ny;
      begin(Math.max(XMIN, Math.min(XMAX, gx * 1.55)));
    } else {
      begin();
    }
  }

  /* the copy sits on top of the canvas, so the whole field listens, not the
     canvas: only links and buttons are allowed to do their own thing */
  const hero = document.querySelector(".nethero");
  if (hero && !reduced) {
    hero.addEventListener("pointerdown", (e) => {
      if (e.target.closest("a, button")) return;
      fire(e);
    });
  }

  const fireBtn = document.querySelector("[data-fire]");
  if (fireBtn && !reduced) fireBtn.addEventListener("click", () => fire(null));

  /* ---------------------------------------------------------------- render -- */

  function draw(tt) {
    const pal = PAL[themeName()];

    gl.clear(gl.COLOR_BUFFER_BIT);

    /* --- edges --- */
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
    gl.uniformMatrix2fv(PE.u.uRot, false, rot);
    gl.uniform3fv(PE.u.uBase, pal.base);
    gl.uniform3fv(PE.u.uHot, pal.hot);
    gl.uniform3fv(PE.u.uCold, pal.cold);
    gl.uniform1f(PE.u.uBandP, bandP);
    gl.uniform1f(PE.u.uBandA, bandA);
    gl.uniform1f(PE.u.uMode, mode);
    gl.uniform1f(PE.u.uLive, live);
    gl.uniform1f(PE.u.uAlpha, pal.alpha);

    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, instCount);

    /* --- nodes --- */
    gl.useProgram(PN.p);

    gl.bindBuffer(gl.ARRAY_BUFFER, nodeBuf);
    const aPos = PN.a("aPos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 12, 0);
    gl.vertexAttribDivisor(aPos, 0);

    const aSeed = PN.a("aSeed");
    gl.enableVertexAttribArray(aSeed);
    gl.vertexAttribPointer(aSeed, 1, gl.FLOAT, false, 12, 8);
    gl.vertexAttribDivisor(aSeed, 0);

    gl.uniform2f(PN.u.uRes, W, H);
    gl.uniform1f(PN.u.uZoom, zoom);
    gl.uniform2f(PN.u.uPar, pointer.x, pointer.y);
    gl.uniformMatrix2fv(PN.u.uRot, false, rot);
    gl.uniform1f(PN.u.uT, tt);
    gl.uniform1f(PN.u.uDpr, dprNow);
    gl.uniform3fv(PN.u.uNode, pal.node);

    gl.drawArrays(gl.POINTS, 0, nodeCount);
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (!last) last = now;
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;

    t += dt;

    if (run) {
      if (run.hold > 0) {
        /* a beat at the end of the forward pass, then the gradient returns */
        run.hold -= dt;
        if (run.hold <= 0) {
          run.dir = 1;
          run.t = 0;
          run.from = XMAX;
          setMode(1);
        }
      } else {
        run.t += dt / 1.7;
        if (run.t >= 1) {
          bandA = 0;
          if (run.dir === 0) run.hold = 0.55;
          else {
            run = null;
            setMode(0);
          }
        } else {
          bandP =
            run.dir === 0
              ? run.from + (XMAX - run.from) * run.t
              : run.from - (run.from - XMIN) * run.t;
          bandA = Math.sin(Math.PI * run.t);
        }
      }
    }

    pointer.x += (pointer.tx - pointer.x) * Math.min(1, dt * 2.4);
    pointer.y += (pointer.ty - pointer.y) * Math.min(1, dt * 2.4);

    live += ((run ? 1 : 0.34) - live) * Math.min(1, dt * 2.6);

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

  if (reduced) {
    /* one composed frame, and nothing to click: the field is a still */
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

  const themeBtn = document.querySelector("[data-theme]");
  const themeLabel = document.querySelector("[data-theme-label]");

  function syncTheme() {
    const ink = themeName() === "ink";
    /* the label names the theme the button takes you to, not the one you are in */
    if (themeLabel) themeLabel.textContent = ink ? "Paper" : "Ink";
    if (themeBtn) {
      themeBtn.setAttribute(
        "aria-label",
        ink ? "Switch to the paper theme" : "Switch to the ink theme"
      );
    }
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", ink ? "#06080d" : "#ffffff");
    applyBlend();
    if (reduced) draw(6.4);
  }

  if (themeBtn) {
    themeBtn.addEventListener("click", () => {
      root.classList.toggle("ink");
      root.classList.toggle("paper");
      try {
        localStorage.setItem("acm-theme", themeName());
      } catch (e) {
        /* private mode: the choice just will not stick */
      }
      syncTheme();
    });
  }

  syncTheme();

  /* a handle for the QA harness */
  window.__net = {
    size: () => ({ w: W, h: H, zoom, edges: edges.length, nodes: nodes.length }),
    setMode: (m) => setMode(m),
    fire: () => fire(null),
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
