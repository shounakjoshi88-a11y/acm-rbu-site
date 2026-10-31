/* ==========================================================================
   ACM RBU — hero machine.

   A dot-built circuit: copper bus solders left-to-right, risers climb to
   component pads, the diamond ring closes around the logo die and the core
   ignites near the end of the pinned hero. Ambient at rest: breathing LEDs,
   a solder tip running the traces, occasional sparks.

   Rules honoured: the page reads fine without this file (CSS no-js fallback),
   the animation pauses offscreen or hidden, and reduced motion renders the
   finished machine once, statically.
   ========================================================================== */

(() => {
  "use strict";

  const hero = document.querySelector(".hero");
  const pin = hero && hero.querySelector(".pin");
  const cv = document.getElementById("mcv");
  const die = hero && hero.querySelector(".hero__die");
  const copy = hero && hero.querySelector(".hero__copy");
  if (!hero || !pin || !cv || !die) return;

  const ctx = cv.getContext("2d");
  if (!ctx) return;

  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  let reduced = mq.matches;

  /* ---------------------------------------------------------- palette ---- */
  /* kept in sync with site.css tokens */
  const C = {
    bus: "#1660c0",
    trace: "#3280e7",
    pad: "#0f74c5",
    ring: "#1660c0",
    led: "#ffc105",
    dust: "rgba(15, 23, 31, 0.9)",
    hot: "#ffd75e",
    sparkCool: "#3280e7",
  };

  const CHASE = 0.14; // progress smoothing per 60fps frame
  const POP = 0.045; // reveal span in progress units
  const FLASH = 180; // ms of solder-pop amber

  /* ------------------------------------------------------------- state ---- */
  let W = 0;
  let H = 0;
  let dpr = 1;
  let dots = []; // sorted by threshold o
  let leds = [];
  let hosts = []; // spark spawn points {x, y, o}
  let tipPaths = [];
  let busPts = [];

  let pops = new Map(); // dot id -> first-lit timestamp
  let sparks = [];
  let tip = null;

  let targetP = 0;
  let dispP = 0;
  let ignited = false;
  let rafId = 0;
  let last = 0;
  let visible = true;

  /* ---------------------------------------------------------- progress ---- */
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  function readProgress() {
    const r = hero.getBoundingClientRect();
    const range = hero.offsetHeight - window.innerHeight;
    targetP = range > 40 ? clamp(-r.top / range, 0, 1) : 1;
  }

  /* ------------------------------------------------------------- rail ----- */
  const rail = document.createElement("div");
  rail.className = "rail";
  rail.setAttribute("aria-hidden", "true");
  const railFill = document.createElement("span");
  rail.appendChild(railFill);
  pin.appendChild(rail);

  /* ------------------------------------------------------------ world ----- */
  function buildWorld() {
    const pinR = pin.getBoundingClientRect();
    const dieR = die.getBoundingClientRect();

    W = Math.max(1, pinR.width || window.innerWidth);
    H = Math.max(1, pinR.height || window.innerHeight);

    dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const cell = W < 520 ? 8 : W < 900 ? 7 : 6;
    const base = cell >= 7 ? 4 : 3.4;

    /* keep the machine quiet behind the reading copy — measure the actual
       text blocks, not the full-width .wrap column */
    let guard = null;
    if (copy) {
      let gx0 = Infinity;
      let gy0 = Infinity;
      let gx1 = -Infinity;
      let gy1 = -Infinity;
      copy.querySelectorAll(".hero__strip, h1, .hero__sub, .hero__cta, .hero__hint").forEach((el) => {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) return;
        gx0 = Math.min(gx0, r.left);
        gy0 = Math.min(gy0, r.top);
        gx1 = Math.max(gx1, r.right);
        gy1 = Math.max(gy1, r.bottom);
      });
      if (gx1 > gx0) {
        guard = {
          x0: gx0 - pinR.left - 10,
          y0: gy0 - pinR.top - 10,
          x1: gx1 - pinR.left + 10,
          y1: gy1 - pinR.top + 10,
        };
      }
    }
    const guarded = (x, y) =>
      guard && x > guard.x0 && x < guard.x1 && y > guard.y0 && y < guard.y1;

    dots = [];
    leds = [];
    hosts = [];
    tipPaths = [];
    busPts = [];
    pops.clear();

    let seq = 0;
    const add = (x, y, c, o, opt = {}) => {
      if (x < 2 || x > W - 2 || y < 2 || y > H - 2) return null;
      const d = {
        id: seq++,
        x: Math.round(x),
        y: Math.round(y),
        s: opt.s || base,
        c,
        o: clamp(o, -0.1, 0.995),
        a: opt.a === undefined ? 1 : opt.a,
        led: !!opt.led,
        ph: Math.random() * Math.PI * 2,
      };
      if (!d.led && guarded(d.x, d.y)) d.a *= 0.42;
      dots.push(d);
      if (d.led) leds.push(d);
      return d;
    };

    /* die + ring geometry */
    const cx = dieR.left + dieR.width / 2 - pinR.left;
    const cy = dieR.top + dieR.height / 2 - pinR.top;
    const plateHalf = Math.max(dieR.width, dieR.height) / 2;
    const ringR = plateHalf + (W < 900 ? 24 : 56);
    const bandL = cx - ringR - 12;
    const bandR = cx + ringR + 12;

    /* ------------------------------------------------------- copper bus -- */
    /* the bus is the machine deck: run it along the floor, and only tuck it
       above the ring when the viewport is too short for that. */
    const floorY = H - 52;
    let busY = floorY;
    let busAbove = false;
    if (cy + ringR + 18 > floorY) {
      const above = cy - ringR - 24;
      if (above > 96) {
        busY = above;
        busAbove = true;
      }
    }
    const dir = busAbove ? -1 : 1;

    const x0 = Math.max(10, cell * 2);
    const x1 = W - Math.max(10, cell * 2);
    const busO = (x) => 0.02 + 0.24 * ((x - x0) / (x1 - x0 || 1));

    for (let x = x0; x <= x1; x += cell) {
      if (Math.round(x / cell) % 3 === 2) continue; // dashed copper
      const d = add(x, busY, C.bus, busO(x), { s: base });
      if (d) busPts.push([d.x, d.y]);
    }
    for (let x = x0 + cell; x <= x1; x += cell * 2) {
      add(x, busY + dir * cell, C.trace, busO(x) + 0.02, { s: base * 0.75, a: 0.8 });
    }

    /* standby stub: the machine is never fully dead, even at progress 0 */
    for (let i = 0; i < 8; i++) add(x0 + i * cell, busY, C.bus, -0.03, { s: base });
    add(x0 + 8 * cell, busY, C.led, -0.03, { s: base + 1.6, led: true });

    /* ----------------------------------------------------------- risers -- */
    const fracs =
      W < 520
        ? [0.14, 0.32, 0.5, 0.87]
        : W < 900
        ? [0.13, 0.3, 0.48, 0.66, 0.88]
        : [0.14, 0.3, 0.45, 0.6, 0.88];

    fracs.forEach((f, k) => {
      const rx = Math.round(f * W);
      if (rx > bandL && rx < bandR) return; // never cross the die

      const hRows = Math.max(6, Math.round((H * (0.34 + 0.1 * ((k * 37) % 3))) / cell));
      const startO = 0.2 + 0.04 * k + 0.05 * f;
      const pts = [];
      let y = busY;

      for (let i = 0; i < hRows; i++) {
        y -= cell;
        add(rx, y, C.trace, startO + (i / hRows) * 0.12, { s: base });
        pts.push([rx, y]);
      }
      tipPaths.push(pts);

      /* pad at the top of the riser */
      const padY = y - cell;
      const padW = W < 520 ? 2 : 3;
      for (let i = 0; i < padW; i++) {
        for (let j = 0; j < 2; j++) {
          const px = rx + (i - (padW - 1) / 2) * cell;
          const d = add(px, padY + j * cell, C.pad, startO + 0.14 + 0.008 * (i + j), {
            s: base * 1.05,
          });
          if (d && i === 0 && j === 0) hosts.push({ x: d.x, y: d.y, o: d.o });
        }
      }

      /* foot pad on the bus */
      for (let i = -1; i <= 1; i++) {
        add(rx + i * cell, busY - dir * cell, C.pad, startO - 0.015, {
          s: base * 0.8,
          a: 0.85,
        });
      }

      /* one lit LED per pad corner */
      const ledD = add(rx + (padW - 1) * cell, padY + cell, C.led, startO + 0.16, {
        s: base + 1.4,
        led: true,
      });
      if (ledD) hosts.push({ x: ledD.x, y: ledD.y, o: ledD.o });
    });

    /* ------------------------------------------------------- ring + LEDs -- */
    const steps = Math.max(72, Math.round((ringR * 5.66) / cell));
    const corners = [0, 1, 2, 3].map((i) => (i / 4) * steps);

    for (let i = 0; i < steps; i++) {
      const t = (i / steps) * Math.PI * 2;
      const u = Math.cos(t);
      const v = Math.sin(t);
      /* axis-aligned square, then rotated 45°: a diamond, the logo's shape */
      const m = Math.max(Math.abs(u), Math.abs(v));
      const su = u / m;
      const sv = v / m;
      const px = cx + (su - sv) * ringR * Math.SQRT1_2;
      const py = cy + (su + sv) * ringR * Math.SQRT1_2;
      const o = 0.48 + (i / steps) * 0.2;
      const isCorner = corners.some((c) => Math.abs(i - c) < steps / 40);

      if (isCorner) {
        const d = add(px, py, C.led, o, { s: base + 1.8, led: true });
        if (d) hosts.push({ x: d.x, y: d.y, o: d.o });
      } else {
        add(px, py, C.ring, o, { s: base, a: 0.9 });
      }
    }

    /* ---------------------------------------------------------- spokes --- */
    /* sideways traces only; the chevron owns the space above the ring */
    const spokes = [
      [1, 0],
      [-1, 0],
    ];
    if (busAbove) spokes.push([0, 1]);
    spokes.forEach(([sx, sy], si) => {
      const len = Math.max(2, Math.round((ringR * (0.35 + 0.12 * si)) / cell));
      const ex = cx + sx * (ringR + (len + 1) * cell);
      const ey = cy + sy * (ringR + (len + 1) * cell);
      if (ex < 10 || ex > W - 10 || ey < 10 || ey > H - 10) return;

      for (let i = 1; i <= len; i++) {
        const px = cx + sx * (ringR + i * cell);
        const py = cy + sy * (ringR + i * cell);
        add(px, py, C.trace, 0.54 + (i / len) * 0.1, { s: base * 0.9, a: 0.85 });
      }
      for (let i = -1; i <= 1; i++) {
        add(ex + (sy ? i * cell : 0), ey + (sx ? i * cell : 0), C.pad, 0.85, {
          s: base * 0.8,
        });
      }
    });

    /* --------------------------------------------------------- chevron --- */
    const chevBase = cy - ringR - 16;
    const chevTop = chevBase - 3 * cell * 3;
    const chevHalf = 3 * cell * 2;
    const chevHitsGuard =
      guard &&
      cx + chevHalf > guard.x0 &&
      cx - chevHalf < guard.x1 &&
      chevTop < guard.y1 &&
      chevBase > guard.y0;
    if (!busAbove && chevTop > 96 && !chevHitsGuard) {
      for (let r = 0; r < 3; r++) {
        const hw = (3 - r) * cell * 2;
        const yBase = chevBase - r * cell * 3;
        const n = Math.round(hw / cell);
        for (let i = -n; i <= n; i++) {
          const px = cx + i * cell;
          const py = yBase - (n - Math.abs(i)) * cell * 0.85;
          const o = 0.66 + r * 0.04 + (Math.abs(i) / n) * 0.06;
          const d = add(px, py, r === 0 ? C.led : C.trace, o, {
            s: r === 0 ? base * 1.1 : base * 0.85,
            led: r === 0 && i === 0,
          });
          if (d && r === 0 && i === 0) hosts.push({ x: d.x, y: d.y, o: d.o });
        }
      }
    }

    /* ------------------------------------------------------------ dust --- */
    const dustCount = Math.round((W * H) / 14000);
    for (let i = 0; i < dustCount; i++) {
      const x = Math.random() * W;
      const y = H * (0.06 + Math.random() * 0.88);
      if (x > bandL - 24 && x < bandR + 24 && Math.abs(y - cy) < ringR + 40) continue;
      add(x, y, C.dust, Math.random() * 0.3, { s: 2.4, a: 0.28 });
    }

    dots.sort((a, b) => a.o - b.o);
    busPts.sort((a, b) => a[0] - b[0]);
  }

  /* ------------------------------------------------------------- draw ----- */
  const easeOutBack = (t) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  };

  function upperBound(p) {
    let lo = 0;
    let hi = dots.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (dots[mid].o <= p) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  function draw(now, dt, animate) {
    if (!dots.length) return;

    ctx.clearRect(0, 0, W, H);
    const cut = upperBound(dispP);

    /* dots, revealed in threshold order */
    for (let i = 0; i < cut; i++) {
      const d = dots[i];
      if (d.led) continue;
      let r = (dispP - d.o) / POP;
      if (r <= 0) continue;
      if (r > 1) r = 1;

      const e = easeOutBack(r);
      const s = d.s * (0.45 + 0.55 * e);
      let alpha = d.a * Math.min(1, r * 1.6);
      let col = d.c;

      if (r < 1) {
        if (!pops.has(d.id)) pops.set(d.id, now);
        else if (now - pops.get(d.id) < FLASH) {
          col = C.led; // solder pop
          alpha = Math.min(1, alpha + 0.2);
        }
      }

      ctx.globalAlpha = alpha;
      ctx.fillStyle = col;
      ctx.fillRect(d.x - s / 2, d.y - s / 2, s, s);
    }

    /* LEDs breathe once their threshold has passed */
    const speed = ignited ? 2.2 : 1;
    for (let i = 0; i < leds.length; i++) {
      const d = leds[i];
      if (d.o > dispP) continue;
      const breathe = animate
        ? 0.6 + 0.4 * Math.sin((now / 620) * speed + d.ph)
        : 0.92;
      const s = d.s;
      ctx.globalAlpha = 0.12 * breathe;
      ctx.fillStyle = C.led;
      ctx.fillRect(d.x - s, d.y - s, s * 2, s * 2);
      ctx.globalAlpha = 0.45 + 0.55 * breathe;
      ctx.fillRect(d.x - s / 2, d.y - s / 2, s, s);
    }

    if (animate) {
      /* solder tip travelling a trace */
      if (!tip && now > nextTipAt && dispP > 0.01) {
        const pool =
          dispP < 0.5 || !tipPaths.length || Math.random() < 0.5
            ? busPts
            : tipPaths[(Math.random() * tipPaths.length) | 0];
        if (pool && pool.length > 6) {
          tip = { path: pool, i: 0, speed: 30 + Math.random() * 26, trail: [] };
        }
        nextTipAt = now + 4200 + Math.random() * 6200;
      }

      if (tip) {
        tip.i += (tip.speed * dt) / 1000;
        const idx = Math.floor(tip.i);
        if (idx >= tip.path.length - 1) {
          tip = null;
        } else {
          const p = tip.path[idx];
          tip.trail.push([p[0], p[1], now]);
          if (tip.trail.length > 9) tip.trail.shift();

          for (let i = 0; i < tip.trail.length; i++) {
            const t = tip.trail[i];
            const age = (now - t[2]) / 460;
            if (age >= 1) continue;
            ctx.globalAlpha = (1 - age) * 0.5;
            ctx.fillStyle = C.led;
            ctx.fillRect(t[0] - 1.6, t[1] - 1.6, 3.2, 3.2);
          }
          ctx.globalAlpha = 0.22;
          ctx.fillStyle = C.led;
          ctx.fillRect(p[0] - 5, p[1] - 5, 10, 10);
          ctx.globalAlpha = 0.95;
          ctx.fillStyle = C.hot;
          ctx.fillRect(p[0] - 2.2, p[1] - 2.2, 4.4, 4.4);
        }
      }

      /* sparks off lit pads and ring corners */
      if (now > nextSparkAt && dispP > 0.2 && sparks.length < 48 && hosts.length) {
        nextSparkAt = now + 280 + Math.random() * 620;
        for (let tries = 0; tries < 5; tries++) {
          const h = hosts[(Math.random() * hosts.length) | 0];
          if (h.o > dispP) continue;
          const ang = Math.random() * Math.PI * 2;
          const sp = 22 + Math.random() * 64;
          sparks.push({
            x: h.x,
            y: h.y,
            vx: Math.cos(ang) * sp,
            vy: Math.sin(ang) * sp - 16,
            life: 520 + Math.random() * 520,
            age: 0,
            c: Math.random() < 0.55 ? C.led : C.sparkCool,
          });
          break;
        }
      }

      for (let i = sparks.length - 1; i >= 0; i--) {
        const sp = sparks[i];
        sp.age += dt;
        if (sp.age >= sp.life) {
          sparks.splice(i, 1);
          continue;
        }
        sp.x += (sp.vx * dt) / 1000;
        sp.y += (sp.vy * dt) / 1000;
        sp.vy += (26 * dt) / 1000;
        const t = 1 - sp.age / sp.life;
        ctx.globalAlpha = t * 0.85;
        ctx.fillStyle = sp.c;
        ctx.fillRect(sp.x - 1.4, sp.y - 1.4, 2.8, 2.8);
      }
    }

    ctx.globalAlpha = 1;

    /* DOM hooks */
    railFill.style.width = (dispP * 100).toFixed(2) + "%";
    const ign = dispP > 0.92;
    if (ign !== ignited) {
      ignited = ign;
      hero.classList.toggle("is-ignited", ignited);
    }
  }

  let nextTipAt = 1400;
  let nextSparkAt = 900;

  /* ------------------------------------------------------------- loop ----- */
  function frame(now) {
    rafId = requestAnimationFrame(frame);
    if (!visible || document.hidden) return;

    const dt = last ? Math.min(64, now - last) : 16.67;
    last = now;

    readProgress();
    const k = 1 - Math.pow(1 - CHASE, dt / 16.67);
    dispP += (targetP - dispP) * k;
    if (Math.abs(targetP - dispP) < 0.0005) dispP = targetP;

    if (pops.size > 4000) pops.clear();
    draw(now, dt, true);
  }

  function start() {
    if (rafId || reduced) return;
    last = 0;
    rafId = requestAnimationFrame(frame);
  }

  function stop() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  }

  /* reduced motion: one static, fully assembled frame */
  function staticPass() {
    stop();
    dispP = 1;
    ignited = true;
    hero.classList.add("is-ignited");
    railFill.style.width = "100%";
    draw(performance.now(), 16.67, false);
  }

  /* ------------------------------------------------------------ events ---- */
  function rebuild() {
    buildWorld();
    readProgress();
    dispP = targetP;
    if (reduced) staticPass();
  }

  let rzTimer = 0;
  window.addEventListener("resize", () => {
    clearTimeout(rzTimer);
    rzTimer = setTimeout(rebuild, 180);
  });

  if ("IntersectionObserver" in window) {
    new IntersectionObserver(
      (entries) => {
        visible = entries[0].isIntersecting;
        if (visible) start();
        else stop();
      },
      { threshold: 0 }
    ).observe(pin);
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stop();
    else if (visible) start();
  });

  const onMotionChange = () => {
    reduced = mq.matches;
    if (reduced) staticPass();
    else {
      dispP = targetP;
      start();
    }
  };
  if (mq.addEventListener) mq.addEventListener("change", onMotionChange);
  else if (mq.addListener) mq.addListener(onMotionChange);

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
      clearTimeout(rzTimer);
      rzTimer = setTimeout(rebuild, 120);
    });
  }

  /* ------------------------------------------------------------- boot ----- */
  buildWorld();
  readProgress();
  dispP = targetP;
  if (reduced) staticPass();
  else {
    draw(performance.now(), 16.67, true);
    start();
  }
})();
