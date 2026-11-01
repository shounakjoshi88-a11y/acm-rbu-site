/* ==========================================================================
   The theme switch.

   One stored choice, honoured by every page. The class is applied by an inline
   script in the document head so the first paint is already the right colour;
   this file only wires the buttons and tells the canvases to redraw.

   Pages disagree only about their default, not about the choice: the home page
   opens on paper and the network page opens on ink, which is what each was
   drawn for. The moment you pick one, both pages follow it.
   ========================================================================== */

(function () {
  var KEY = "acm-theme";
  var root = document.documentElement;
  var buttons = document.querySelectorAll("[data-theme-set]");

  function current() {
    return root.classList.contains("ink") ? "ink" : "paper";
  }

  function paint() {
    var name = current();

    for (var i = 0; i < buttons.length; i++) {
      var b = buttons[i];
      b.setAttribute("aria-pressed", b.getAttribute("data-theme-set") === name ? "true" : "false");
    }

    /* the browser draws its own chrome from this, so the phone's status bar
       stops being white above a dark page */
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", name === "ink" ? "#06080d" : "#f6f9fc");

    document.dispatchEvent(
      new CustomEvent("themechange", { detail: { theme: name } })
    );
  }

  function set(name, remember) {
    var ink = name === "ink";
    root.classList.toggle("ink", ink);
    root.classList.remove("paper");

    if (remember) {
      try {
        localStorage.setItem(KEY, name);
      } catch (e) {
        /* private mode: the choice simply will not outlive the tab */
      }
    }

    paint();
  }

  for (var i = 0; i < buttons.length; i++) {
    buttons[i].addEventListener("click", function (e) {
      set(e.currentTarget.getAttribute("data-theme-set"), true);
    });
  }

  paint();

  /* a handle for the QA harness */
  window.__theme = { current: current, set: set };
})();
