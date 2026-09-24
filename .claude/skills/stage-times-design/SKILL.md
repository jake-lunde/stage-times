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
   Across 236 screens the only exceptions were text inputs (~8.6pt), cards, and bottom sheets
   (~38pt). **Every card and tile is one radius, 18pt** (owner ruling 2026-09-20, from the Apple
   Store's single-radius discipline; see `references/store-density.md`). **Zero sharp corners
   anywhere.**
2. **One decision per screen.** 500–700pt of a 926pt screen is empty. The emptiness is the
   product, not an oversight.
3. **No shadows. No gradients.** Card edges are a single-step color change, verified at the pixel
   level. Surfaces separate by color contrast alone. **One exemption (owner ruling, 2026-09-20):
   the art area of a card.** Inside the art slot, gradients and blur are allowed — that is where
   the generative stage art lives and where a glow is the point. Nothing outside the slot gets
   either: grounds, pills, chips, type, and card edges stay flat.
4. **Two type sizes carry ~80% of the UI** — 16pt for anything actionable or titular, 14pt for
   anything secondary. Seven sizes exist in total; you almost certainly need two.
5. **Labels are one or two plain words.** "Add calendar", "Copy link", "Confirm". Never
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
  --r-card:     18px;  /* every card and tile — one radius (was 16 / 24)   */
  --pad-shelf:  28px;  /* inside a shelf card; --pad-card stays for compact  */
  --gap-shelf:  20px;  /* between cards on a shelf                           */
  --gap-section: clamp(48px, 6vw, 64px);  /* shelf → next section header     */
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
| Shelf card title · shelf section header (`references/store-density.md`) | 24 phone / 28 | 600 / expanded | Archivo |
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
   footer row with metadata left and the action right. Radius 18pt like every card. **Retired
   from the landing page by ticket 06 (2026-09-20); the directory uses the shelf (6).** Nothing
   on the site uses it today.
4. **Card carousel** — horizontal scroll of media cards, one per snap stop: cards ~86% of the
   viewport wide, `scroll-snap-type: x mandatory`, snap to center, the next card peeking ~24pt.
   Scrollbar hidden; the peek IS the affordance. This is CSS scroll-snap doing the "scroll-jack"
   feel natively — never hijack the wheel with JS. **This is the stage list on the subscribe
   page.** From 735pt up it is not a carousel at all (owner ruling, 2026-09-22): the page widens
   to the Store's 980pt column and the stage cards reflow into a two-up grid that stacks top to
   bottom, 20pt gutters, the all-stages card one column wide. The weekend pills, disclosures and
   banner keep the phone measure. A sideways strip cut off at the column edge is a phone gesture
   left on a desktop.
5. **Row list** — 48pt leading element at 16pt, text at 80pt, 80pt row pitch, **no dividers**.
6. **Shelf** — the Apple Store landing page: a two-sentence section header (bold lead, quiet
   tail, same size, one line) over a horizontal row of fixed-height, text-first cards with
   28pt inside padding, 20pt between, one 18pt radius. On a phone one card owns the shelf with
   a 24pt peek. From 735pt up it is not a shelf at all (owner, 2026-09-23): the page takes the
   980pt column and every card shows, two to a row, the art held at the 6:5 it is cut to — the
   stage cards' ruling, for the same reason. Measured values, the density rules, and the
   mapping onto our tokens are in `references/store-density.md` — load it before building any
   page that lists more than one thing. **This is the homepage directory (ticket 06).**

**Single content in the viewport.** At any scroll position on a phone, one card / one idea should
own the screen. If two cards are fully visible at once, the cards are too small or the spacing is
too tight. The carousel enforces this horizontally; section spacing (`--gap-6`+) enforces it
vertically. Desktop-width screens are the exception: two or three cards in a row is the point
of a directory, and two stage cards to a row is how the subscribe page reads on a wide screen.
On the shelf the fixed card width (not a percentage) is what keeps the phone reading as one
card while the desktop reads as a row.

## Card art

Two sources of art, one per card, image area always edge-to-edge:

1. **The festival's own art** on every directory card — `assets/festivals/<festival-key>.<ext>`,
   copied to `dist/assets/festivals/` by the build. **A directory card's cover is always the
   festival's artwork, never art the build draws** (owner ruling, 2026-09-22): a listed edition
   with no committed image waits off the homepage — its page and calendars stay live — and the
   build log names the file it needs. The Facets fallback retired the same day. Store the file in
   the repo; never hotlink the festival's CDN (their cache headers, their outages, their
   tracking). Use the edition's own key art: the logo lockup and illustration off the official
   site or poster, never a crowd photo. Poster art is usually a tall sheet with the lineup in the
   middle; cut the art, not the lineup — keep the festival's own composition, drop the lineup
   text between the top and bottom bands, close the gap on the poster's own ground, and cut the
   frame to the card's art slot (~1.2:1) so nothing the festival drew is sliced at the edge.
   `austin-city-limits-2026.webp` is the worked example: the 25-years admat's logotype over its
   skyline band.
2. **The beads** on every stage card (owner pick, 2026-09-21; `beadsArt()` in `src/pages.ts`,
   explorer and rationale in `_ref/stage-art-explorer/`). The art area is the stage color mixed
   45% toward cream. On it: a ring per festival day, evenly spaced from the center to the card
   edge (the outer ring clips top and bottom); a bead per set in the card's text color (cream,
   or ink on a light festival color; `references/color.md`) at its clock position, 2 PM
   at twelve, clockwise through the night, bead size from set length; the ring drawn solid only
   across the hours the stage runs that day. Each night's billed headliner (the stage's
   `headliners:` list, else the last set of the night; a night runs until 6 AM) is a four-point
   star. The headliner names cycle in the center as a poster block — the night and the start time in mono
   caps above the name in expanded display type, ink on the light ground — about four seconds
   each, and the closer's star lights in the stage color while its name is up. Rings drift at
   their own speeds; stars stay upright. Nothing is random: every mark is a set. CSS animation on
   static SVG, so the build stays byte-reproducible; under reduced motion the first name stays.
   The old seeded capsules retired with ticket 06 (2026-09-20).

Never a stock photo, never AI-generated imagery. Inside the art slot the flat rule is lifted
(non-negotiable 3): the generative art may use gradients and bloom, and it is the one place on
the site that may. Its parameters come from the sets — count, start time, length, guessed ends,
how late the stage runs — so the art is the schedule drawn, not a texture. Nothing is seeded
and nothing is random; the build stays byte-reproducible. The directory card is not generated
at all: it is the festival's own art.

### Navigation bar

**The subscribe page has no back button** (owner ruling, 2026-09-23). Its bar is sticky: a
56pt strip that stays at the top as the page scrolls, filled with the page color so it reads as
transparent while covering what scrolls under it, **no hairline**. Left: the "Stage Times"
wordmark (14pt expanded caps, `--red-deep`, a 44pt-tall link home) — that is the way home.
Right: the festival name and year at 16pt/600, hidden while the big title is in view and
faded in once the title scrolls out (a script watches the title; with no script the name is
simply there). The removed page keeps the same bar, static. The upload page still has the old
transparent top bar with a 44pt icon-only back control at the margin.

An X, never a label, for anything modal — the lightbox's close is a 44pt icon button. **Never
a "‹ Back" text label** anywhere.

### The top area (subscribe page, owner 2026-09-23, from the Apple product page)

Eyebrow, big title, plain lines, then the posters in one row across the page. One column at
every width:

- **Eyebrow** — the days and the city in the lockup style (14pt expanded caps, `--red-deep`):
  `FRI 7 AUG – SUN 9 AUG · SEATTLE`, two weekends as `OCT 2–4 & OCT 9–11 · AUSTIN`. No year;
  the title has it.
- **Title** — the festival name, 40pt expanded, the year in `--ink-soft` after it.
- **Two lines**, 17pt/500 ink, sentence case: `79 sets across 4 stages.` then
  `One calendar per stage. Add the ones you want.` Nothing else before the stages.
- **Official posters** — eyebrow `OFFICIAL POSTERS`, then one tile per posted day in a
  horizontal row (below). No hint line under them (owner, 2026-09-23): the tiles say what they are.

### Official posters

The festival's own posted schedule images, committed at `assets/schedule/<key>/<YYYY-MM-DD>.<ext>`
and served from `/assets/schedule/`, so a reader can check the times against what the festival
printed before adding a calendar. **Never hotlinked; never drawn by the build**; a file named
by its date gets the day as its caption and lands in day order.

- **Tiles**: small on purpose — the calendars below outrank them (owner, 2026-09-23): 72pt
  wide on a phone, 80pt from 735pt, 4:5, `object-fit: cover` from the top, the one 18pt
  radius, in **one horizontal row** — the carousel pattern (scroll-snap x, no
  scrollbar, bleeding to the margin on a phone so the next day peeks; in the column on a wide
  screen, scrolling only when more days than fit). Under each, the day in 11pt mono caps on
  one line (`FRI 7 AUG`), `--ink-soft`. The tile is a link to the image, so it works with no script.
  Shrinks on press. The word "poster" is the owner's call for this one eyebrow (2026-09-23);
  everywhere else the source is still "the official schedule".
- **Lightbox** (`<dialog>`): one image on a fixed ink ground in either scheme, fitted to the
  viewport with the card radius; **tap the image to see it at full width and scroll, tap again
  to fit** — the times have to be readable on a phone. The day in mono caps top-left, a 44pt X
  top-right, and with more than one day a left/right icon pair bottom-center (arrow keys too).
  Tap the ground or press Escape to close. No thumbnails strip, no counter, no zoom slider.

### Dividers

Mostly absent. A 9-row settings list and a 7-row merchant list both had none. Where genuinely
needed: 1px `--paper-line`, inset to `--margin-text`. Prefer spacing over rules.

## Copy rules

Full rules — voice, vocabulary to use, vocabulary to avoid, the tone test, and the three
readers every string is checked against — are in `references/copy.md`. **Load it before writing
any user-facing string**, including buttons, disclosures, errors, calendar names, and event
bodies. It is distilled from the three-reader review of the live site
(`docs/copy-review-2026-09-06.md`, 6 Sep 2026), which is the evidence behind every rule.

The six that decide most lines:

- **One person who goes to shows, telling you what they know.** Never "we", never "our" — there
  is no company behind this site. First person singular, and only for a limitation or an
  invitation.
- **The action label is "Add calendar", never "Subscribe."** Ruled 6 Sep 2026 against all three
  readers. "Subscribe" implies an account, and Google Calendar's own menu says *Add calendar →
  From URL*, so our label and the fallback instructions match. It survives only as the internal
  analytics event name and when quoting another platform's UI.
- **The site is at its best describing the festival and at its worst describing itself.** If a
  sentence explains the machinery — iCalendar fields, feeds, refresh hints, IANA zones, repo
  paths, GitHub issues — cut it or say it in the reader's words.
- **Never say something is happening that might not be.** `Opening Calendar…` is true on iOS
  and false on Android; any state label that can be wrong ships with its recovery line.
- **State platform limits plainly, and never imply instant updates.** Google Calendar can't add
  by URL from mobile — say exactly that, behind a disclosure, with the literal menu path. Apple
  checks about twice a day; Google runs 12–24h or longer.
- **Sentence case for sentences, not Title Case For Headings.** US spelling. No exclamation
  marks. Every page footer carries: unofficial/not-affiliated, attribution to the official
  schedule, a last-updated stamp, a way to report a wrong time, and a rights-holder contact.

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
- [ ] Stage art is drawn from the sets, never from a clock or `Math.random()` — build output
      stays byte-identical; directory card art is the festival's own committed image
- [ ] On a wide screen nothing scrolls sideways that is cut off at the column edge — the
      stage carousel and the homepage shelf are two-up grids from 735pt
- [ ] No `box-shadow`, no `linear-gradient`
- [ ] Nothing is pure `#FFF` or pure `#000`
- [ ] No cream text under 17pt on any colored surface (see contrast table)
- [ ] `prefers-color-scheme` respected; no theme toggle
- [ ] `prefers-reduced-motion` respected
- [ ] Reads correctly at 320px wide and at 200% text zoom
- [ ] Every string passes `references/copy.md` — read aloud as if telling a friend in a crowd,
      no "we", no machinery vocabulary, and the action label reads "Add calendar"

## Reference files

- `references/color.md` — palette, tokens, measured contrast table, per-stage colors
- `references/screens.md` — the two screens this product has, and what they deliberately omit
- `references/copy.md` — voice, vocabulary, the tone test, and the three readers every string
  is written for
- `references/store-density.md` — content and density for pages that list more than one
  thing, measured off the Apple Store landing page (Sep 2026): shelf, card, header, and type
  scale, plus the token changes they imply
