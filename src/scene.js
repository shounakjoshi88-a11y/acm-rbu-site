/* ==========================================================================
   ACM RBU — the mark, drawn as a field of ink.

   Two passes, the way Modal builds their hero. Pass 1 ray-marches the
   sculpture once per glyph cell into an off-screen target, so every cell gets a
   real surface luminance and a real normal. Pass 2 walks the same hexagonal
   cell grid at pixel level and stamps one SDF glyph per cell, coloured from
   that luminance.

   Light room: the ramp is inverted. A face in shadow resolves as paper and
   fades out of the page; a face under the key light resolves as saturated blue
   ink. Nothing here is a sprite — the sculpture is drawn one cell at a time.

   Three forms trade places on a seven-second cycle: three stacked plates (the
   cube), a cube frame, and the chapter's chevron. Two dim echoes of earlier
   moments trail it. Scroll tilts the object and pushes the cycle on; the
   pointer nudges it.
   ========================================================================== */

const canvas = document.querySelector("[data-stage]");
const hero = document.querySelector(".hero");
const glow = document.querySelector("[data-glow]");
const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const gl = canvas
  ? canvas.getContext("webgl2", {
      antialias: false,
      alpha: true,
      premultipliedAlpha: true,
      powerPreference: "high-performance",
    })
  : null;

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const smooth = (x) => x * x * (3 - 2 * x);

/* --------------------------------------------------------------- shaders -- */

const VS = `#version 300 es
in vec2 a;
void main() { gl_Position = vec4(a, 0.0, 1.0); }`;

const HASH = `float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}`;

/* One fragment per glyph cell: march a lit solid, keep its luminance. R is the
   body of the object, G is the echo behind it. */
const FS1 = `#version 300 es
precision highp float;

uniform vec2 uRes;
uniform float uCell;
uniform float uT;
uniform float uS;
uniform float uIntro;
uniform float uTilt;
uniform vec2 uShift;
uniform vec3 uW;

out vec4 o;

${HASH}

float TT;

mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

float sdRB(vec3 p, vec3 b, float r) {
  vec3 q = abs(p) - b;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - r;
}

float sdFrame(vec3 p, vec3 b, float e) {
  p = abs(p) - b;
  vec3 q = abs(p + e) - e;
  return min(min(
    length(max(vec3(p.x, q.y, q.z), 0.0)) + min(max(p.x, max(q.y, q.z)), 0.0),
    length(max(vec3(q.x, p.y, q.z), 0.0)) + min(max(q.x, max(p.y, q.z)), 0.0)),
    length(max(vec3(q.x, q.y, p.z), 0.0)) + min(max(q.x, max(q.y, p.z)), 0.0));
}

float sdSeg2(vec2 p, vec2 a, vec2 b, float r) {
  vec2 pa = p - a, ba = b - a;
  return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0)) - r;
}

/* the chapter's mark: two arms meeting at a point. Lying flat it is one of the
   three plates; standing up it is the whole mark. */
float sdChevron(vec2 q, float t) {
  return min(
    sdSeg2(q, vec2(-0.95, 1.0), vec2(0.72, 0.0), t),
    sdSeg2(q, vec2(0.72, 0.0), vec2(-0.95, -1.0), t));
}

/* a chevron extruded flat into a plate */
float sdChevronPlate(vec3 p, float t, float h) {
  return max(sdChevron(p.xz, t), abs(p.y) - h);
}

float map(vec3 p) {
  p.yz *= rot(-0.42 - uTilt);
  float d = 0.0;

  if (uW.x > 0.001) {
    /* three stacked plates, turning slowly against the clock */
    vec3 q = p;
    q.xz *= rot(0.16 * sin(TT * 0.7854));
    float ds = 1e3;
    for (int i = -1; i <= 1; i++) {
      ds = min(ds, sdChevronPlate(q - vec3(0.0, float(i) * 0.66, 0.0), 0.34, 0.21));
    }
    d += uW.x * ds;
  }

  if (uW.y > 0.001) {
    /* a cube frame, one corner turning toward the viewer */
    vec3 q = p;
    q.xz *= rot(0.7854 + 0.3 * sin(TT * 0.62));
    d += uW.y * sdFrame(q, vec3(1.0), 0.13);
  }

  if (uW.z > 0.001) {
    /* the chevron standing up as a ribbon, rocking so its edge catches the
       light — the outline of the chapter's mark, in the air */
    vec3 q = p * 0.95;
    q.xz *= rot(0.22 * sin(TT * 0.5));
    d += uW.z * max(sdChevron(q.xy, 0.13), abs(q.z) - 0.3) / 0.95;
  }

  return d;
}

/* Returns how much light lands on the surface (0..1), or 0 for a miss. */
float shade(vec2 uv, int steps) {
  vec3 p;
  float t = 0.0, d;
  bool hit = false;

  for (int i = 0; i < 64; i++) {
    if (i >= steps) break;
    p = vec3(uv, -8.0 + t);
    d = map(p);
    if (d < 0.005) { hit = true; break; }
    t += d * 0.75;
    if (t > 16.0) break;
  }
  if (!hit) return 0.0;

  vec2 k = vec2(1.0, -1.0) * 0.006;
  vec3 n = normalize(
    k.xyy * map(p + k.xyy) +
    k.yyx * map(p + k.yyx) +
    k.yxy * map(p + k.yxy) +
    k.xxx * map(p + k.xxx));

  float dif = max(dot(n, normalize(vec3(0.55, 0.75, -0.5))), 0.0);
  float fres = pow(1.0 - max(dot(n, vec3(0.0, 0.0, -1.0)), 0.0), 3.0);

  /* a slow sheen sliding across the surface */
  float sweep = mod(TT, 7.0) * 1.5 - 4.0;
  float sheen = exp(-pow((dot(p.xy, normalize(vec2(1.0, 0.6))) - sweep) * 1.8, 2.0));

  float lit = 0.17 + 0.5 * pow(dif, 1.5) + 0.45 * fres + 0.35 * sheen * (0.3 + dif);

  /* stacked layers shadow each other: the lower a plate sits, the less light
     reaches it, which is what tells three identical faces apart */
  float layer = clamp(0.5 - p.y * 0.62, 0.0, 1.0);
  lit *= 1.0 - 0.5 * layer;

  return clamp(lit, 0.12, 1.0);
}

/* Ink, not light: a face the key never reaches takes the most ink, a face
   turned into the light is left as paper. Never quite zero, so a highlight
   reads as a break in the ink rather than a hole in the object. */
float ink(float lit) {
  /* never fully paper: a face turned into the light still holds a pale wash of
     ink, otherwise the whole upper half of the stack dissolves into the page */
  return clamp(1.3 - 1.75 * lit, 0.17, 1.0);
}

void main() {
  float i = floor(gl_FragCoord.x), j = floor(gl_FragCoord.y);
  vec2 c = vec2((i + 0.5 * mod(j, 2.0)) * uCell, j * 0.866 * uCell);

  /* the object sits low in the stage, with air under it */
  vec2 off = c - vec2(uRes.x * 0.5, uRes.y * 0.7) - uShift;
  off.y = -off.y;

  float reveal = step(hash(vec2(j, i) + 7.0), clamp(uIntro * 2.4 - length(off) / uS * 0.4, 0.0, 1.0));

  TT = uT;
  float lit = shade(off / uS, 60);
  float v = lit > 0.01 ? ink(lit) * reveal : 0.0;
  float g = 0.0;

  if (v < 0.01) {
    /* two dim, larger echoes of an earlier moment */
    vec2 g1 = vec2(0.038, 0.018) * uRes;
    vec2 g2 = vec2(-0.042, -0.012) * uRes;

    TT = uT - 1.4;
    float l1 = shade((off - g1) / uS / 1.05, 34);
    g = l1 > 0.01 ? ink(l1) * 0.62 : 0.0;

    if (g < 0.01) {
      TT = uT - 2.8;
      float l2 = shade((off - g2) / uS / 1.05, 34);
      g = l2 > 0.01 ? ink(l2) * 0.5 : 0.0;
    }

    g *= (1.0 - clamp(length(off) / (uS * 2.4), 0.0, 1.0)) * reveal;
  }

  o = vec4(v, g, 0.0, 1.0);
}`;

/* Per pixel: the glyph of its own cell, in blue ink, premultiplied so it sits
   on the page without a background of its own. */
const FS2 = `#version 300 es
precision highp float;

uniform vec2 uRes;
uniform float uCell;
uniform sampler2D uTex;
uniform ivec2 uTS;
uniform float uInk;

out vec4 o;

${HASH}

float dSeg(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0));
}

/* One glyph per cell: a dot whose radius carries the tone, with a rare four
   point star for texture in the mid tones. Modal's field is dots first; the
   stars are the exception, not the pattern. */
float glyph(vec2 g, float lvl, float h, float aa) {
  float d = length(g) - (0.06 + 0.42 * lvl);

  if (lvl > 0.24 && lvl < 0.62 && h < 0.14) {
    float R = 0.1 + 0.16 * lvl;
    float st = 1e3;
    for (int k = 0; k < 2; k++) {
      float an = float(k) * 1.5708 + 0.7854;
      vec2 dir = vec2(cos(an), -sin(an));
      st = min(st, dSeg(g, -dir * R, dir * R));
    }
    d = min(d, st - 0.03);
  }

  return 1.0 - smoothstep(-aa, aa, d);
}

/* paper, wash, blue, ink — and on the ink set, the same four stops read from
   the other side: the densest part of the mark is the brightest, so it sits on
   a dark page the way the blue sits on a white one */
vec3 ramp(float l) {
  vec3 c0 = vec3(0.80, 0.86, 0.98);
  vec3 c1 = vec3(0.66, 0.77, 0.96);
  vec3 c2 = vec3(0.22, 0.44, 0.88);
  vec3 c3 = vec3(0.04, 0.13, 0.35);

  if (uInk > 0.5) {
    c0 = vec3(0.09, 0.14, 0.28);
    c1 = vec3(0.16, 0.28, 0.58);
    c2 = vec3(0.37, 0.56, 0.97);
    c3 = vec3(0.82, 0.91, 1.00);
  }

  return l < 0.35 ? mix(c0, c1, l / 0.35)
       : l < 0.7 ? mix(c1, c2, (l - 0.35) / 0.35)
       : mix(c2, c3, (l - 0.7) / 0.3);
}

void main() {
  vec2 px = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 q = px / uCell, r = vec2(1.0, 1.732), hf = r * 0.5;
  vec2 a = mod(q, r) - hf, b = mod(q - hf, r) - hf;
  vec2 gv = dot(a, a) < dot(b, b) ? a : b;
  vec2 id = q - gv;

  float j = floor(id.y / 0.866 + 0.5);
  float col = floor(id.x - 0.5 * mod(j, 2.0) + 0.5);
  vec4 t = texelFetch(uTex, clamp(ivec2(col, j), ivec2(0), uTS - 1), 0);

  float h = hash(vec2(col, j));
  float aa = 1.5 / uCell;

  vec3 c = vec3(0.0);
  float al = 0.0;

  if (t.r > 0.01) {
    al = glyph(gv, t.r, h, aa);
    c = ramp(t.r);
  } else if (t.g > 0.01) {
    /* the dim echoes trail the mark: pale wash on paper, faint blue in the dark */
    float amb = uInk > 0.5 ? 0.16 : 0.1;
    al = glyph(gv, t.g, h, aa) * amb;
    c = uInk > 0.5
      ? mix(vec3(0.06, 0.09, 0.19), vec3(0.17, 0.27, 0.52), t.g)
      : mix(vec3(0.72, 0.80, 0.95), vec3(0.42, 0.56, 0.88), t.g);
  }

  o = vec4(c * al, al);
}`;

/* ------------------------------------------------------------- behaviour -- */

if (!gl) {
  /* no WebGL2: the poster carries the hero instead */
  document.documentElement.classList.add("no-gl");
} else {
  boot(gl);
}

function boot(gl) {
  const CELL_CSS = 9; /* glyph size on screen, in CSS pixels */
  const CELL_CSS_NARROW = 7; /* a phone stage is small: finer cells keep the form readable */
  const PERIOD = 7.0; /* seconds per form */
  const TRANS = 1.8; /* seconds spent trading one form for the next */
  const POSTER_T = 3.2; /* a settled pose, for stills */

  function program(fs) {
    const p = gl.createProgram();
    for (const [type, src] of [
      [gl.VERTEX_SHADER, VS],
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
    return { p, u };
  }

  const P1 = program(FS1);
  const P2 = program(FS2);

  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const tex = gl.createTexture();
  const fbo = gl.createFramebuffer();

  let W = 2;
  let H = 2;
  let CELL = 10;
  let S = 100;
  let anchorY = 0.7;
  let TW = 2;
  let TH = 2;

  /* which set the ramp is read against; the switch flips it without a reload */
  let inkMode = document.documentElement.classList.contains("ink");
  let lastTT = 0;
  let lastP = 0;

  function resize() {
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 1.75);

    W = Math.max(2, Math.round(r.width * dpr));
    H = Math.max(2, Math.round(r.height * dpr));
    if (canvas.width !== W) canvas.width = W;
    if (canvas.height !== H) canvas.height = H;

    CELL = Math.max(5, Math.round((W < 700 ? CELL_CSS_NARROW : CELL_CSS) * dpr));

    /* A pinned, full-bleed stage gives the mark the bottom half of the viewport
       and lets it rise. A slab stage — a phone, or reduced motion — has to hold
       the whole mark, so it is scaled to its own height and centred in it. */
    const slab = H < window.innerHeight * dpr * 0.8;
    anchorY = slab ? 0.5 : 0.68;
    S = slab ? Math.min(W * 0.3, H * 0.2) : Math.min(W * 0.3, H * (W / H > 1.2 ? 0.146 : 0.155));

    TW = Math.ceil(W / CELL) + 2;
    TH = Math.ceil(H / (CELL * 0.866)) + 2;

    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, TW, TH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    if (glow) {
      glow.width = Math.max(2, Math.ceil(W / 5));
      glow.height = Math.max(2, Math.ceil(H / 5));
    }
  }

  /* ------------------------------------------------------------- inputs -- */

  let progress = reduced ? 1 : 0;
  let shown = progress;
  let intro = reduced ? 1 : 0;
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };

  function readProgress() {
    if (!hero) return 1;
    const r = hero.getBoundingClientRect();
    const range = hero.offsetHeight - window.innerHeight;
    return range > 40 ? clamp(-r.top / range, 0, 1) : 1;
  }

  window.addEventListener(
    "pointermove",
    (e) => {
      pointer.tx = (e.clientX / window.innerWidth - 0.5) * 2;
      pointer.ty = (e.clientY / window.innerHeight - 0.5) * 2;
    },
    { passive: true }
  );

  /* -------------------------------------------------------------- render -- */

  function weights(tt) {
    /* the cycle opens on the cube, which is the form the page is about */
    const k = (Math.floor(tt / PERIOD) + 1) % 3;
    const nx = (k + 1) % 3;
    const tr = smooth(clamp((tt % PERIOD - (PERIOD - TRANS)) / TRANS, 0, 1));
    const w = [0, 0, 0];
    w[k] = 1 - tr;
    w[nx] += tr;
    return w;
  }

  function render(tt, p) {
    const w = weights(tt);
    lastTT = tt;
    lastP = p;

    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, TW, TH);
    gl.useProgram(P1.p);
    gl.uniform2f(P1.u.uRes, W, H);
    gl.uniform1f(P1.u.uCell, CELL);
    gl.uniform1f(P1.u.uT, tt);
    gl.uniform1f(P1.u.uS, S * (1 + 0.1 * p));
    gl.uniform1f(P1.u.uIntro, intro);
    gl.uniform1f(P1.u.uTilt, 0.06 * (1 - p));
    gl.uniform2f(P1.u.uShift, pointer.x * S * 0.1, pointer.y * S * 0.07 - (0.68 - anchorY) * H);
    gl.uniform3f(P1.u.uW, w[0], w[1], w[2]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(P2.p);
    gl.uniform2f(P2.u.uRes, W, H);
    gl.uniform1f(P2.u.uCell, CELL);
    gl.uniform1i(P2.u.uTex, 0);
    gl.uniform2i(P2.u.uTS, TW, TH);
    gl.uniform1f(P2.u.uInk, inkMode ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    /* the halo is just the same frame at a fifth of the size, blown back up by
       the browser: free blur, and it reads as ink bleeding into paper */
    if (glow) {
      const g = glow.getContext("2d");
      g.clearRect(0, 0, glow.width, glow.height);
      g.drawImage(canvas, 0, 0, glow.width, glow.height);
    }
  }

  let raf = 0;
  let running = false;
  let t = 0;
  let last = 0;

  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (!last) last = now;
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    t += dt;

    if (intro < 1) intro = Math.min(1, intro + dt / 2.2);

    progress = readProgress();
    shown += (progress - shown) * Math.min(1, dt * 4.5);
    if (Math.abs(progress - shown) < 0.0005) shown = progress;

    pointer.x += (pointer.tx - pointer.x) * Math.min(1, dt * 2.6);
    pointer.y += (pointer.ty - pointer.y) * Math.min(1, dt * 2.6);

    /* scroll pushes the cycle on, so the mark answers the page */
    render(t + shown * 3.5, shown);
  }

  function start() {
    if (running) return;
    running = true;
    last = 0;
    frame(performance.now());
  }

  function stop() {
    running = false;
    cancelAnimationFrame(raf);
    raf = 0;
  }

  resize();
  new ResizeObserver(() => {
    resize();
    render(t + shown * 3.5, shown);
  }).observe(canvas.parentElement);

  if (reduced) {
    render(POSTER_T, 1);
  } else {
    render(0, 0);

    if ("IntersectionObserver" in window) {
      new IntersectionObserver(
        (entries) => {
          entries[0].isIntersecting ? start() : stop();
        },
        { threshold: 0 }
      ).observe(hero || canvas);
    } else {
      start();
    }

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) stop();
      else start();
    });
  }

  /* the switch redraws the frame in place: the field keeps its time, only the
     ramp changes side */
  document.addEventListener("themechange", () => {
    inkMode = document.documentElement.classList.contains("ink");
    render(lastTT, lastP);
  });

  /* the poster renderer, and a handle for the QA harness */
  window.__stage = {
    setProgress(p) {
      progress = p;
      shown = p;
      intro = 1;
      pointer.x = pointer.tx = 0;
      pointer.y = pointer.ty = 0;
      render(POSTER_T, p);
    },
    /* a still at a chosen point in the cycle; holds the loop so QA screenshots
       are deterministic */
    setTime(tt) {
      stop();
      intro = 1;
      render(tt, shown);
    },
    size: () => ({ w: W, h: H, cell: CELL, s: S }),
    snap(mime = "image/png", quality = 1, scale = 1, tt = POSTER_T) {
      /* redraw first: the drawing buffer is not preserved between tasks */
      render(tt, shown);
      const out = document.createElement("canvas");
      out.width = Math.round(W * scale);
      out.height = Math.round(H * scale);
      const g = out.getContext("2d");
      g.imageSmoothingQuality = "high";
      g.drawImage(canvas, 0, 0, out.width, out.height);
      return out.toDataURL(mime, quality);
    },
  };
}
