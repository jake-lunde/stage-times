---
name: stage-times-design
description: The visual system for Stage Times — Cash App's structural conventions (big dumb buttons, minimal super-clear text, capsule geometry, one decision per screen) rendered in a four-color retro screenprint palette. Load before writing or changing any HTML, CSS, or page copy in this repo, and before adding any new screen, component, or button.
---

# Stage Times design system

Two sources, cleanly separated:

- **Structure** — measured from 236 Cash App iOS screenshots (`_ref/Cash App ios Nov 2025/`,
  1284×2898 @3x, all values below in pt = px/3). Spacing, geometry, type scale, layout archetypes.
- **Color** — the Fritz Coffee Company screenprint in `_ref/color-reference/`. See
  `references/color.md`.

Every number here was measured off the images. Where a value varies, the dominant value is given
with its range. Don't substitute remembered values from the real Cash App — the measurements win.

A happy accident worth knowing: the Capitol Hill Block Party posters in `_ref/set-screenshots/`
are *already* in this idiom — cream paper, flat saturated blocks, chunky uppercase grotesque, zero
gradients. The palette and the source material agree.

## The one-sentence brief

**Big dumb buttons and minimal, super-clear text.** If a screen makes someone read a sentence to
find the tap target, it's wrong.

## Non-negotiables

1. **Everything is a capsule.** `border-radius: 50%` of height on every button, chip, and field.
   Across 236 screens the only exceptions were text inputs (~8.6pt), cards (16pt media cards
   24pt), and bottom sheets (~38pt). **Zero sharp corners anywhere.**
2. **One decision per screen.** 500–700pt of a 926pt screen is empty. The emptiness is the
   product, not an oversight.
3. **No shadows. No gradients.** Card edges are a single-step color change, verified at the pixel
   level. Surfaces separate by color contrast alone.
4. **Two type sizes carry ~80% of the UI** — 16pt for anything actionable or titular, 14pt for
   anything secondary. Seven sizes exist in total; you almost certainly need two.
5. **Labels are one or two plain words.** "Subscribe", "Copy link", "Add to calendar". Never
   "Continue to the next step". Explanation is demoted to an underlined inline link.
6. **Touch targets are oversized.** Primary CTA is 52pt tall and near-full-width — 18% above
   Apple's 44pt minimum. Nothing tappable is under 32pt.

## Tokens

```css
:root {
  /* ── spacing: 4pt base, 8pt steps, 16pt module ────────────────────────── */
  --gap-1:  8px;   /* sibling cards; side-by-side button pairs; chips        */
  --gap-2:  12px;  /* tonal row → primary CTA                                */
  --gap-3:  16px;  /* stacked CTA pair; grid gutters; stacked form fields    */
  --gap-4:  24px;  /* section header → first row                            */
  --gap-5:  32px;  /* between card groups                                   */
  --gap-6:  40px;  /* above a section header                                */

  --margin:      16px;  /* dominant screen margin: cards, nav icons, CTAs   */
  --margin-text: 24px;  /* text-content screens, list-row text inset        */
  --pad-card:    16px;  /* card padding, all round                          */

  /* ── geometry ─────────────────────────────────────────────────────────── */
  --h-btn:      52px;  --r-btn:   26px;  /* primary + large tonal, r = h/2  */
  --h-btn-sm:   44px;  --r-btn-sm: 22px; /* stacked/secondary               */
  --h-chip:     32px;  --r-chip:  16px;
  --h-icon:     44px;                     /* icon button, circle             */
  --h-field:    52px;  --r-field:  8px;  /* the ONE non-capsule control     */
  --r-card:     16px;
  --r-card-media: 24px;                   /* media cards + carousel cards    */
  --border-hairline: 1px;

  /* ── type ─────────────────────────────────────────────────────────────── */
  --t-display: 60px; --lh-display: 0.98;  /* hero wordmark, expanded caps   */
  --t-title:   40px; --lh-title:   1.02;  /* screen title, left-aligned     */
  --t-card:    30px; --lh-card:    1.05;  /* card heading — big and light   */
  --t-large:   24px;                      /* section-level headings         */
  --t-body:    17px; --lh-body:    1.5;   /* row title, button label, copy  */
  --t-small:   14px;                      /* subtitle, chip                 */
  --t-mono:    13px;                      /* metadata/caption, Fragment Mono */
  --t-micro:   12px;                      /* uppercase eyebrow, mono        */
  --t-legal:   12px;                      /* fine print, mono               */

  --w-heading: 630;  /* display + titles: the expanded width carries the weight */
  --w-semi: 600; --w-med: 500; --w-reg: 400;
  --track-caps: 0.07em;  /* uppercase headers only */

  /* ── motion ───────────────────────────────────────────────────────────── */
  --press: scale(.96);
  --t-press: 120ms;   /* transform transition on everything tappable */
}
```

Colors are in `references/color.md`. Load it before writing any CSS.

## Typography

The reference face is Cash Sans — a tight neo-grotesque with a **very tall x-height (x/cap ≈
0.72)**, near-monolinear strokes, closed apertures, and noticeably tight tracking (~0.58em average
advance at 24pt). We don't imitate it with the system stack anymore — the system stack is the
single loudest "this was generated" tell (owner feedback, 2026-08-09).

**Two faces, both self-hosted** (files in `assets/fonts/`, copied to `dist/assets/fonts/` by the
build — never loaded from a CDN; "works on festival wifi" survives because the font comes from
the same origin as the page, `font-display: swap`, preloaded):

1. **Archivo** — variable, `wght 100–900`, `wdth 62–125`. One family, two voices:
   the **expanded cut (`font-stretch:125%`) is the display voice** — wide, planted, screenprint-
   poster confidence for the wordmark, titles, and card headings. Normal width (100%) is the body
   voice. Never use the condensed end (<100%) — one width gesture, used consistently, is a
   personality; two is a mess.
2. **Fragment Mono** — the fine-detail voice. Footer, legal, captions, metadata lines, uppercase
   eyebrows, URLs. Helvetica-flavored mono, so it reads as the spec-sheet margin notes on the
   screenprint rather than as code.

```css
--font-sans: "Archivo", ui-sans-serif, -apple-system, "Helvetica Neue", Arial, sans-serif;
--font-mono: "Fragment Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
```

Weight discipline (owner feedback): **headings got bigger and lighter, not heavier.** Display and
headings sit at 600–650, never 800. The expanded width does the work that fake-bold used to do.
Body is 400, actionable labels 600.

Everything actionable is **16pt semibold minimum**. This is also what makes cream-on-red legal —
see the contrast table in `references/color.md`.

### Scale

| Role | Size | Weight / width | Face |
|---|---|---|---|
| Hero wordmark | 56–64 | 650 / expanded, uppercase | Archivo |
| Screen title (festival name) | 40 / 1.02 | 630 / expanded | Archivo |
| Card heading (stage / festival name on card) | 28–34 / 1.05 | 600 / expanded | Archivo |
| Row title · button label | 16–17 | 600 / normal | Archivo |
| Body | 16–17 / 1.5 | 400 / normal | Archivo |
| Caption · metadata line | 13 | 400 | Fragment Mono |
| Uppercase eyebrow | 11–12 + `--track-caps` | 400, uppercase | Fragment Mono |
| Legal · footer | 12–13 / 1.6 | 400 | Fragment Mono |

Note the display sizes shrink with content in the reference (a keypad `$0` at 71pt cap vs `$100`
at 41pt cap — a 1.75× reduction). Apply the same instinct: a long festival name gets a smaller
title. Don't let a title wrap to three lines to preserve a token.

## Buttons

The whole product is one button pressed a few times. Get these right and the rest follows.

```css
.btn {
  display: flex; align-items: center; justify-content: center;
  width: 100%; height: var(--h-btn); border-radius: var(--r-btn);
  font-size: var(--t-body); font-weight: var(--w-bold);
  border: 0; cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.btn--primary   { background: var(--red);       color: var(--paper); }
.btn--primary:active { background: var(--red-deep); }
.btn--tonal     { background: var(--paper-sunk); color: var(--ink); }
.btn--on-color  { background: var(--paper);      color: var(--ink); }  /* inside a stage card */
.btn--sm        { height: var(--h-btn-sm); border-radius: var(--r-btn-sm); }
.btn:disabled   { background: var(--ink-faint); color: var(--paper); cursor: default; }
```

Three button species (owner feedback 2026-08-09, modeled on the Apple Store app):

1. **Pill** — the classes above. The one primary action of a surface. Capsule, filled, label only.
2. **Text button** — a bare 16pt/600 label in the action color, no fill, no border, no underline
   (underline is for inline prose links only). Apple's "Buy now". Use for secondary actions that
   would compete with the pill if they had a fill: "See the full lineup", "Official site". Still
   a ≥44pt touch target — pad it invisibly.
3. **Icon button** — a 44pt circle, filled `--paper-sunk` (or translucent cream on a colored
   card), containing a single inline SVG glyph, no label. For compact utility actions on detail
   cards — copy-link is the canonical case. `aria-label` is mandatory.

The old rule was "never put an icon inside a button." The surviving form of that rule: **never
mix an icon and a label in the same button.** A pill holds words; an icon button holds one glyph;
nothing holds both.

Measured conventions to preserve:

- **Bottom-anchored primary is at a fixed position**: 16pt above the safe-area inset, full width
  at the screen margin. On the web: `padding-bottom: max(16px, env(safe-area-inset-bottom))`.
- **Side-by-side pairs are 8pt apart. Stacked pairs are 16pt apart**, secondary above primary.
- **Destructive is a tonal button with red text**, not a red button. Ours: `--paper-sunk` fill,
  `--red-deep` label.

### Press feedback

Everything tappable **shrinks under the thumb**: `transform: scale(.96)` on `:active`, with
`transition: transform 120ms ease` so release springs back. Pills, text buttons, icon buttons,
festival cards, nav chevrons — all of it. This replaces color-only pressed states as the primary
acknowledgment (color shift stays on the primary pill as a bonus, not a substitute). Zeroed out
under `prefers-reduced-motion`.

## Layout archetypes

Use one per screen; don't blend them.

1. **Bottom-anchored single action** — content top-aligned, large empty middle, one pill at the
   bottom. The default.
2. **Stacked action pair** — 44pt tonal above 44pt primary.
3. **Media card** — the Apple Store / Cash App "More for you" card: image area on top (edge to
   edge inside the card, no padding), then eyebrow, then a big light-weight heading, then a
   footer row with metadata left and the action right. Radius 24pt (media cards are the second
   exception to the 16pt card radius). **This is the festival card on the landing page.**
4. **Card carousel** — horizontal scroll of media cards, one per snap stop: cards ~86% of the
   viewport wide, `scroll-snap-type: x mandatory`, snap to center, the next card peeking ~24pt.
   Scrollbar hidden; the peek IS the affordance. This is CSS scroll-snap doing the "scroll-jack"
   feel natively — never hijack the wheel with JS. **This is the stage list on the subscribe
   page.** Degrades on desktop: cards still snap with trackpad/drag, and a full-width fallback
   under 3 items is fine.
5. **Row list** — 48pt leading element at 16pt, text at 80pt, 80pt row pitch, **no dividers**.

**Single content in the viewport.** At any scroll position on a phone, one card / one idea should
own the screen. If two cards are fully visible at once, the cards are too small or the spacing is
too tight. The carousel enforces this horizontally; section spacing (`--gap-6`+) enforces it
vertically.

## Card art

Two sources of art, one per card, image area always edge-to-edge:

1. **A real festival image** when one exists — `assets/festivals/<festival-key>.<ext>`, copied to
   `dist/assets/festivals/` by the build. Landing-card hero. Store the file in the repo; never
   hotlink the festival's CDN (their cache headers, their outages, their tracking).
2. **Procedural screenprint art** everywhere else — deterministic SVG generated at build time,
   seeded by `festival-key/stage-id` (FNV-1a → mulberry32; **never `Math.random()`** — the build
   must stay byte-reproducible). The composition: vertical capsules of varying height and offset
   in translucent cream and a deepened cut of the stage color, flat fills only, on the stage-color
   flood. It's the design system drawing itself: capsule geometry, screenprint flatness, per-stage
   identity. On stage cards the art area also carries the **headliner preview** — up to three
   artist names from the manifest, cream, ≥17pt semibold (the large-text contrast rule applies).

Never a stock photo, never a gradient mesh, never AI-generated imagery.

### Navigation bar

Leading icon-only control at the 16pt margin — a back arrow, or an X for anything modal. **Never
a "‹ Back" text label.** Title either centered at 16pt bold, or omitted entirely with a 32pt
left-aligned title in the content below. **No fill, no hairline under it** — the bar is
transparent over the page color.

### Dividers

Mostly absent. A 9-row settings list and a 7-row merchant list both had none. Where genuinely
needed: 1px `--paper-line`, inset to `--margin-text`. Prefer spacing over rules.

## Copy rules

- Sentence case for sentences, not Title Case For Headings.
- State platform limitations plainly rather than implying capability we don't have. The brief
  requires saying Google Calendar can't subscribe by URL from mobile — say exactly that, put it
  behind a disclosure, and print the literal menu path.
- Never imply instant updates. Apple honors `REFRESH-INTERVAL`; Google refreshes on its own
  schedule, often 12–24h. Say so.
- Every page carries: unofficial/not-affiliated, attribution to the official schedule, a
  last-updated stamp, and an error-report link.

## Checklist before shipping a page

- [ ] Loads with zero third-party requests — fonts are self-hosted woff2 from `dist/assets/fonts/`
      (Archivo + Fragment Mono, picked from Google Fonts but never served by it). The one script
      exception (owner-approved 2026-08-08): the same-origin Vercel Web Analytics snippet
      (`/_vercel/insights/script.js`) — cookieless, aggregate-only, served by our own deployment
- [ ] Both woff2s preloaded, `font-display: swap` — text is readable before fonts arrive
- [ ] Every interactive element ≥32pt, primary actions 52pt; icon buttons 44pt circles with
      `aria-label`
- [ ] Every button and chip is a capsule; no button mixes an icon with a label
- [ ] Everything tappable shrinks on press (`scale(.96)`, 120ms) — zeroed under reduced motion
- [ ] Card headings are big and light (600–650 expanded), never small and heavy
- [ ] Carousels are CSS scroll-snap — no JS scroll hijacking, no visible scrollbar
- [ ] Procedural art is seeded from festival/stage keys — build output stays byte-identical
- [ ] No `box-shadow`, no `linear-gradient`
- [ ] Nothing is pure `#FFF` or pure `#000`
- [ ] No cream text under 17pt on any colored surface (see contrast table)
- [ ] `prefers-color-scheme` respected; no theme toggle
- [ ] `prefers-reduced-motion` respected
- [ ] Reads correctly at 320px wide and at 200% text zoom

## Reference files

- `references/color.md` — palette, tokens, measured contrast table, per-stage colors
- `references/screens.md` — the two screens this product has, and what they deliberately omit
