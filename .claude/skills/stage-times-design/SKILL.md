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
   Across 236 screens the only exceptions were text inputs (~8.6pt), cards (16pt), and bottom
   sheets (~38pt). **Zero sharp corners anywhere.**
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
  --h-field:    52px;  --r-field:  8px;  /* the ONE non-capsule control     */
  --r-card:     16px;
  --border-hairline: 1px;

  /* ── type ─────────────────────────────────────────────────────────────── */
  --t-display: 56px; --lh-display: 1.02;  /* hero wordmark                  */
  --t-title:   32px; --lh-title:   1.01;  /* screen title, left-aligned     */
  --t-large:   24px;                      /* tab-root title, stage name     */
  --t-body:    16px; --lh-body:    1.5;   /* row title, button label, copy  */
  --t-small:   14px;                      /* subtitle, caption, chip        */
  --t-micro:   12px;                      /* uppercase section header       */
  --t-legal:   12px;                      /* fine print                     */

  --w-bold: 700; --w-semi: 600; --w-med: 500; --w-reg: 400;
  --track-caps: 0.07em;  /* uppercase headers only */
}
```

Colors are in `references/color.md`. Load it before writing any CSS.

## Typography

The reference face is Cash Sans — a tight neo-grotesque with a **very tall x-height (x/cap ≈
0.72)**, near-monolinear strokes, closed apertures, and noticeably tight tracking (~0.58em average
advance at 24pt). Weight runs heavy: every title, row title, and button label measured at
stem/cap 0.15–0.16, i.e. Semibold–Bold. Body copy sits at 0.11–0.12.

**We ship no webfont.** This page loads on festival wifi at 2am; a 40KB font blocking first paint
to save a little character is a bad trade. Use the system stack and lean on weight and size to do
the work:

```css
font-family: ui-sans-serif, -apple-system, "Helvetica Neue", Arial, sans-serif;
```

On iOS this resolves to SF Pro, which has a shorter x-height and looser tracking than Cash Sans.
Compensate: set headings at `letter-spacing: -0.02em` and go one weight heavier than instinct says.

Everything actionable is **16pt semibold minimum**. This is also what makes cream-on-red legal —
see the contrast table in `references/color.md`.

### Scale

| Role | Size | Weight | Color |
|---|---|---|---|
| Hero wordmark | 56 | 700 | `--paper` on `--red` |
| Screen title | 32 / 1.01 | 700 | `--ink` |
| Stage name on card | 24 | 700 | `--paper` |
| Row title · button label · body | 16 / 1.5 | 600 / 400 | `--ink` |
| Subtitle · caption · chip | 14 | 500 | `--ink-soft` |
| Uppercase section header | 12 + `--track-caps` | 600 | `--ink-soft` |
| Legal | 12 | 400 | `--ink-soft` |

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

Measured conventions to preserve:

- **Bottom-anchored primary is at a fixed position**: 16pt above the safe-area inset, full width
  at the screen margin. On the web: `padding-bottom: max(16px, env(safe-area-inset-bottom))`.
- **Side-by-side pairs are 8pt apart. Stacked pairs are 16pt apart**, secondary above primary.
- **Never put an icon inside a button.** Not in 236 screens.
- **Destructive is a tonal button with red text**, not a red button. Ours: `--paper-sunk` fill,
  `--red-deep` label.

## Layout archetypes

Use one per screen; don't blend them.

1. **Bottom-anchored single action** — content top-aligned, large empty middle, one pill at the
   bottom. The default, and correct for the subscribe flow.
2. **Stacked action pair** — 44pt tonal above 44pt primary.
3. **Grouped card list** — sunk page color, cards at the 16pt margin, 8pt between siblings, 32pt
   between groups, 16pt padding. **This is the subscribe page.**
4. **Row list** — 48pt leading element at 16pt, text at 80pt, 80pt row pitch, **no dividers**.

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

- [ ] Loads with zero third-party requests — no webfont, no CDN. The one script exception
      (owner-approved 2026-08-08): the same-origin Vercel Web Analytics snippet
      (`/_vercel/insights/script.js`) — cookieless, aggregate-only, served by our own deployment
- [ ] Every interactive element ≥32pt, primary actions 52pt
- [ ] Every button and chip is a capsule
- [ ] No `box-shadow`, no `linear-gradient`
- [ ] Nothing is pure `#FFF` or pure `#000`
- [ ] No cream text under 17pt on any colored surface (see contrast table)
- [ ] `prefers-color-scheme` respected; no theme toggle
- [ ] `prefers-reduced-motion` respected
- [ ] Reads correctly at 320px wide and at 200% text zoom

## Reference files

- `references/color.md` — palette, tokens, measured contrast table, per-stage colors
- `references/screens.md` — the two screens this product has, and what they deliberately omit
