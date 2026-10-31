# ACM RBU Student Chapter — site design spec

Date: 2026-10-31
Status: home page shipped; Events / Gallery / Team are next phases.

## 1. What this is

A new public site for the ACM Student Chapter at Ramdeobaba University, Nagpur
(formerly RCOEM, est. 18 October 2018). The old chapter URL
`rbustudentchapter.acm.org` is dead — nothing resolves and no archive exists — so
this is a rebuild, not a redesign.

Launch scope is the **home page as hub**. Events, Gallery and Team exist in the
navigation and footer as "in assembly" slots until those pages are written, so
nothing on the page is a promise the site cannot keep.

## 2. Concept

The whole page is a machine. Not "techy decoration" — every element is a part:

| Page element | Machine reading |
| --- | --- |
| Hero canvas | a circuit being assembled as you scroll |
| Section labels | engraved plates (`plate 01 · about`) |
| Cards | machined panels with corner screws |
| Stats | readouts on chips |
| Accent marks | amber status LEDs (never text) |
| Join section | the power bay: dark, lit from above |
| Hero logo | the die — the core that ignites at full assembly |

The scroll story in the hero is the signature moment: a copper bus solders along
the floor, risers climb to component pads, a diamond ring (the logo's own shape)
closes around the die, a chevron emitter sits above it, and the die powers on at
92% progress. The rest of the page has no scroll animation — only LED breathing
and hover feedback.

## 3. Design system

Tokens live in `src/site.css` under `:root`.

### Colour

| Token | Value | Use |
| --- | --- | --- |
| `--paper` | `#f6f9fc` | page surface |
| `--card` | `#ffffff` | raised panels |
| `--ink` | `#0f171f` | text, key buttons, power bay |
| `--ink-2` | `#3d4a57` | body copy |
| `--ink-3` | `#5f707c` | mono labels, captions |
| `--steel` | `#d9dfe5` | panel borders, dividers |
| `--steel-2` | `#edf1f6` | inner rules, screws |
| `--blue` | `#3280e7` | traces, pads, links |
| `--blue-deep` | `#1660c0` | bus, focus rings, ignition |
| `--blue-ink` | `#0f74c5` | inline link text |
| `--amber` | `#ffc105` | **LEDs only** — never text, never a background for text |

The blues come from the ACM SRM chapter site the user pointed at; the layout
shares nothing with it. Amber is deliberately restricted: a 7px dot with a 3px
wash halo, solder-pop flashes, and the vision quote's left rule.

### Type

- Display: **Space Grotesk** 500 / 700 — headings, UI, body.
- Mono: **IBM Plex Mono** 400 / 600 — plate labels, dates, stats, legal.
- Self-hosted woff2 in `src/media/fonts/`, 16 faces, latin / latin-ext /
  vietnamese / cyrillic subsets with `unicode-range` preserved.
  Regenerate with `node tools/fetch-fonts.mjs` (never hand-edit `fonts.css`).

Rules: no all-caps eyebrow labels, no accent-coloured word inside a headline,
line length capped at 62–68ch, `text-wrap: balance` on headings.

### Shape and depth

- Panels: 1px `--steel` border, 12px radius, one soft long shadow, plus four
  radial "screws" drawn in `::before` at 9px from each corner.
- Buttons are machined keys: 4px solid bottom shadow that compresses on press
  (`translateY` + shadow shrink), so clicking feels physical.
- Section rhythm: 76–126px vertical padding, 1px `--steel` divider between bands,
  alternating `--paper` / `--card` surfaces.

## 4. Page structure

1. **Hero** (pinned, 320vh desktop / 280vh mobile) — strip line, headline,
   sub, two CTAs, scroll hint, die plate, canvas, progress rail.
2. **`#manifest`** — vision quote + four commitments, `plate 01 · about`.
3. **`#record`** — six real throughput numbers on chips.
4. **`#programs`** — six module panels: five real activity lines plus one
   deliberately dashed "open slot".
5. **`#moments`** — five transmission cards, two with photography.
6. **`#crew`** — two faculty coordinators + the student crew card.
7. **`#join`** — the power bay: email, LinkedIn, and the "not built yet" note.
8. **Footer** — brand, site links, connect links, chapter record.

## 5. Content mapping (all real, all sourced)

Sources: the chapter's official RBU profile PDF, its LinkedIn page
(@acm-rbu, 18 members), Instagram @acm_rbu, and the Prajwalan microsite.
No invented events, no invented people, no invented numbers.

| Slot | Content | Source |
| --- | --- | --- |
| Founded | 18 Oct 2018, seeded by Dr. Sachin Lodha's TCS talk | RBU PDF |
| Faculty coordinators | Dr. Devishree Naidu, Prof. Dhanashree Junghare | RBU PDF |
| Contact | info@rbustudentchapter.acm.org | RBU PDF |
| 1300 | INNOVANZA'25 participants | RBU PDF |
| 300 | AICWiC 2020 participants | RBU PDF |
| 629 | largest single session attendance | RBU PDF |
| 350 | Abhyankar memorial talk attendance | RBU PDF |
| 50 | Winter School cohort | RBU PDF |
| 18 | crew size | LinkedIn |
| TIRP (Oct 2026) | Lambence Pvt. Ltd. + CDPC Cell | Instagram post 2026-10-11 |
| ECOTHON (Feb 2026) | Code for a Greener Tomorrow | Instagram post 2026-02-04 |
| Winter School | Digital Twins | RBU PDF |
| Prajwalan | links to `acm-prajwalan.vercel.app` | existing microsite |
| Technofrenzy 3.0 | Shadows of Hollywood | RBU PDF |

If a fact is not in that table it does not go on the page. The footer states
plainly that the site is assembled and maintained by the student crew.

## 6. Accessibility and resilience

- Skip link, single `<h1>`, landmark elements, 23 focusable controls, visible
  `:focus-visible` ring in `--blue-deep`.
- Canvas is `aria-hidden`; nothing it draws carries meaning. All copy is real DOM.
- `prefers-reduced-motion: reduce` → the machine renders once, fully assembled,
  statically, and the hero collapses to 100svh (no pinned scroll to scrub).
- No JS → `html.no-js` keeps the hero in normal flow, hides canvas and rail, and
  centres the die below the copy. Verified: hero 872px, die visible.
- The canvas pauses via `IntersectionObserver` offscreen and on
  `visibilitychange`, and skips work while hidden.
- Contrast: body copy `--ink-2` on `--paper` ≈ 8.6:1; mono captions `--ink-3`
  ≈ 4.9:1; amber is decorative only, so it never carries text contrast.
- No horizontal overflow at 1440, 1024, 900, 640, 380.

## 7. Engineering

```
src/index.html      hand-written, no framework
src/site.css        design system, all tokens, all breakpoints
src/fonts.css       generated by tools/fetch-fonts.mjs
src/machine.js      hero assembly engine (vanilla canvas 2D)
src/media/          logo, cover, 8 event photos, 16 woff2
build.mjs           src → dist (four files + media), 844 KB total
serve.mjs           dev server on 127.0.0.1:4174
vercel.json         static build, immutable cache on /media
```

`machine.js` details worth knowing before touching it:

- Dots are collected, then sorted by reveal threshold `o`; each frame binary
  searches the cut point, so cost is O(lit) not O(all).
- Reveal bands: bus 0.02–0.26, risers 0.20–0.44, pads +0.14, diamond ring
  0.48–0.68, spokes 0.54+, chevron 0.66–0.82, ignition at 0.92.
- Progress chases the scroll target at `CHASE = 0.14` per 60fps frame, so it
  settles instead of snapping.
- The "quiet zone" is the union of the strip / h1 / sub / CTA / hint rects —
  **not** the full-width `.wrap` column. Dots inside draw at 0.42 alpha; LEDs
  are exempt so the machine still reads behind the copy.
- The bus sits on the floor (`y = H − 52`) and only tucks above the ring when
  the viewport is too short; risers and spokes check for collisions first.
- A standby stub (negative threshold, `o = −0.03`) plus one LED keeps the
  machine alive at progress 0 — the hero is never a dead blank.
- Rebuild on `resize` (debounced 180ms) and on `document.fonts.ready`, because
  die position depends on layout.

## 8. Pipeline

```powershell
cd D:\Q_project\projects\acm-rbu
node build.mjs                      # src -> dist
node serve.mjs 4174                 # local preview
npx vercel@latest deploy --prod     # deploy dist/ per vercel.json
```

QA harness lives outside the repo at
`C:\Users\shoun\AppData\Local\Temp\opencode\pptr-core\shoot-acm.cjs`; it shoots
desktop 1440×900, mobile 375×812, reduced-motion and no-JS, and asserts no
console errors, no overflow, font load, ignition at P=1, and that the CTA is the
topmost element at its own centre point (canvas must sit under the copy).

## 9. Next phases

1. **Events** — full archive list, filterable by year, same transmission cards.
2. **Gallery** — the eight photos become a proper grid with captions and dates.
3. **Team** — current crew with roles, plus a chapter timeline from 2018.
4. Swap the `in assembly` slots in nav and footer for real links as each page
   ships; the "More pages are still in assembly" note in `#join` goes last.
