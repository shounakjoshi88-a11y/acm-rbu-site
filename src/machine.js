/* ==========================================================================
   ACM RBU — hero power-up.

   The mainboard is drawn in the page (SVG); this only reports scroll position
   into a single custom property, --p, and the drawing responds in CSS. Traces
   light, pads come up, the die at the socket powers on.

   No canvas, no per-frame drawing: one property write per frame, and nothing
   at all when the hero is off screen or the tab is hidden.
   ========================================================================== */

(() => {
  "use strict";

  const hero = document.querySelector(".hero");
  if (!hero) return;

  const rail = hero.querySelector(".rail span");
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");

  let raf = 0;
  let visible = true;
  let shown = 0;
  let reduced = mq.matches;

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  function read() {
    const r = hero.getBoundingClientRect();
    const range = hero.offsetHeight - window.innerHeight;
    return range > 40 ? clamp(-r.top / range, 0, 1) : 1;
  }

  function apply(p) {
    hero.style.setProperty("--p", p.toFixed(4));
    if (rail) rail.style.width = (p * 100).toFixed(1) + "%";
  }

  function frame() {
    raf = requestAnimationFrame(frame);
    if (!visible || document.hidden) return;

    const target = read();
    shown += (target - shown) * 0.2;
    if (Math.abs(target - shown) < 0.001) shown = target;
    apply(shown);
  }

  function start() {
    if (raf || reduced) return;
    shown = read();
    apply(shown);
    raf = requestAnimationFrame(frame);
  }

  function stop() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  /* reduced motion: the machine is simply already powered */
  function settle() {
    stop();
    hero.style.removeProperty("--p");
    if (rail) rail.style.width = "100%";
  }

  if ("IntersectionObserver" in window) {
    new IntersectionObserver(
      (entries) => {
        visible = entries[0].isIntersecting;
        if (visible) start();
        else stop();
      },
      { threshold: 0 }
    ).observe(hero);
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stop();
    else if (visible) start();
  });

  const onMotion = () => {
    reduced = mq.matches;
    if (reduced) settle();
    else start();
  };
  if (mq.addEventListener) mq.addEventListener("change", onMotion);
  else if (mq.addListener) mq.addListener(onMotion);

  if (reduced) settle();
  else start();
})();
