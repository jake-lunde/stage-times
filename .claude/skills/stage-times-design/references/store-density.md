# Store density

The content and density reference for any page that lists more than one thing — first the
homepage directory (ticket 06). Measured off the live Apple Store landing page
(apple.com/store, 20 September 2026) with computed CSS, not eyeballed from a screenshot: a
1024px desktop pane and a 375px phone emulation. Every number below is what the browser
reported.

**Scope.** This file governs *content, density, spacing, radius, and type scale* for shelf
pages. It does **not** change color: the palette in `color.md` (cream paper, ink, red action)
stands, and where the Store's greys and whites are named below they are named to be mapped
onto our tokens, never adopted.

## What the page is made of

Eight sections, one shape, top to bottom:

1. **Header block** — a one-word H1 flush left; a two-line semibold subhead; two text links
   with an ↗ glyph. Nothing else. No image, no flood.
2. **Product nav shelf** — eleven small tiles (image + one-word label), horizontal scroll.
3. **Six card shelves**, each: a one-line section header (bold lead sentence + grey tail
   sentence, same size, inline) then a horizontal shelf of fixed-height cards.
4. **Quick links** — five outlined capsule chips.
5. **Footnotes** — a dense 12px grey block, longer than everything above it combined.

Every section has the same left edge (22px gutter) and the same header treatment. The page
is a vertical stack of horizontal shelves; variety comes from the cards, never from the
frame.

## Measured index

### Frame

| Attribute | Desktop (1024) | Phone (375) |
|---|---|---|
| Gutter (content left edge) | 22px | 22px |
| Content column | 980px | viewport − 44 |
| Page field | `#F5F5F7` | same |
| Card fill | `#FFF` (or `#000` for the featured-product shelf) | same |
| Card radius | **18px, everywhere** | 18px |
| Shelf item gap | **20px** | 20px |
| Header → first card | ~24px | ~24px |
| Last card → next header | ~64–68px | ~50px |
| Section pitch (header to header) | 624px with 500px cards | ~580px with 450px cards |

One radius for every card, tile, and focus ring: 18px. Capsule only on the quick-link chips
(38px tall) and the paddle arrows (45px circle). Text inputs don't appear on the page.

### Header block

| Element | Desktop | Phone |
|---|---|---|
| H1 "Store" | 80px / 600 / 84 / −1.2px tracking | 48px / 600 / 52 |
| Subhead | 28px / 600 / 32, right column, right-aligned, 2 lines | 21px / 600, left, stacked under H1 |
| Text links | 14px / 400, action blue `#0066CC`, no underline, ↗ | same, stacked |
| H1 bottom → product nav | 90px | ~130px (subhead and links in between) |

Content: one word, one sentence of promise, two exits. That's the whole header.

### Product nav shelf

| Attribute | Desktop | Phone |
|---|---|---|
| Tile | 136 × 148 | 100 × 120 |
| Image inside tile | 120 × 78 | 92 × 60 |
| Label | 14px / 600, one word | same |
| Tile pitch | 146 (gap 10) | 110 (gap 10) |
| Shelf bottom → first section header | 83px | ~57px |

### Section header

```
<h2 class="mainheader">The latest.</h2> <span class="secondaryheader">Take a look at what's new.</span>
```

| Attribute | Desktop | Phone |
|---|---|---|
| Lead | 28px / 600 / 32, ink `#1D1D1F`, `display:inline` | 24px / 600 / 28 |
| Tail | **same size and weight**, grey `#6E6E73`, inline, wraps with the lead | same |
| Tracking | +0.196px (positive at display sizes) | — |

Both halves are full sentences and both end in a period. The lead is 1–3 words; the tail is
4–9 words. No eyebrow above, no link beside, no "See all."

### Shelf card (the "ccard")

Text at the **top**, image filling the **bottom**. Fixed height per shelf.

| Attribute | Desktop | Phone |
|---|---|---|
| Card | 400 × 500 (4:5) | 309 × 450 |
| Card as share of viewport | 39% (2.4 cards visible) | **82%**, next card peeks 24px |
| Content padding | **28px all round** | 28px |
| Eyebrow | 12px / 600, 8px below; orange `#FF791B` for NEW / PRE-ORDER, grey `#424245` for category labels in caps | 12px / 600, 7px below |
| Title | 28px / 600 / 32, one line | 21px / 600 / 25, up to two lines |
| Lead line | 14px / **600** / 18, 10px above, 6px below | same, 6px above |
| Body / price lines | 14px / 400 / 18, up to 3 lines | same |
| Text block height | ~218px of 500 | — |
| Image | edge-to-edge below the text, no padding, no caption | same |

Per card: **one eyebrow, one title, one bold lead sentence, one to three plain lines. About
five lines of text, then picture.** Nothing is centered. There is no button on the card; the
whole card is the link.

### Wide card variant

The "Help is here" and "Apple experience" shelves use 480 × 500 cards (pitch 500, gap 20)
with the same 28px padding, a grey uppercase eyebrow, and a 28px title that runs to two
lines. Same anatomy, wider.

### Tile grid variant

The "Apple Store difference" shelf is one 400 × 500 card followed by a 2 × 3 grid of
313 × 240 tiles (gap 20), each: a 28px glyph, then a 24px / 600 / 28 sentence with
key phrases colored. Same radius, same padding.

### Product card (accessories, audio)

| Attribute | Value |
|---|---|
| Card | 313 × 500, white, 18px radius, 28px padding |
| Image area | 257 × 271, 41px padding above the image, product centered on white |
| Swatch dots | 12px circles, 19px above / 14px below |
| Eyebrow | 12px / 600 orange "New" or "Free engraving" |
| Title | 17px / 600 / 21, up to 2 lines |
| Price | 14px / 400 |

### Chips, arrows, footnotes

| Element | Value |
|---|---|
| Quick-link chip | 38px tall, capsule (`border-radius:980px`), 1px ink border, transparent fill, 14px / 400, padding 8 × 15, gap 13 |
| Paddle arrow | 45px circle, `rgba(210,210,215,.64)` fill, desktop only, appears on hover |
| Footnotes | 12px / 400 / 16, grey `#6E6E73`, full column width |

### Type inventory

Distinct (size / weight / line-height) combinations across the page, by frequency:

| Combination | Uses | Role |
|---|---|---|
| 12 / 400 / 16 | 219 | footnotes |
| 14 / 400 / 18 | 171 | card body, price |
| 28 / 600 / 32 | 72 | section header lead + tail, card title |
| 12 / 600 / 16 | 54 | eyebrow |
| 17 / 600 / 21 | 24 | product-card title |
| 14 / 400 / 20 | 23 | header-block copy |
| 24 / 600 / 28 | 15 | tile sentence |
| 14 / 600 / 18 | 14 | card lead line |
| 80 / 600 / 84 | 1 | H1 |

**Two weights (400, 600) and six sizes (80, 28, 24, 17, 14, 12) carry the entire page.**
Tracking is negative at text sizes (−0.374 at 17, −0.224 at 14, −0.12 at 12) and positive
at display sizes (+0.196 at 28, +0.216 at 24), then tight again at 80 (−1.2).

Scroll: `scroll-snap-type: none` on every shelf. Apple scrolls with JS. We don't (see
below).

## The density rules, stated

These are what to carry into Stage Times. They are about content and rhythm; the color
column of every decision is "ours."

1. **A page of lists is a stack of shelves with one frame.** Same gutter, same header
   treatment, same card radius, same shelf gap on every section. Variety lives inside the
   cards.
2. **A section header is two sentences in one line: a bold lead and a quiet tail.** Same
   size, same weight, inline, both ending in a period. Lead ≤ 3 words, tail ≤ 9. Nothing else
   on that line.
3. **A shelf card is text-first: eyebrow, title, one bold lead line, up to three plain
   lines, then art edge-to-edge to the bottom.** About five lines of text. No button inside
   the card; the card is the link.
4. **28px inside a card. 20px between cards. 24px header-to-shelf. 48–64px shelf-to-next-header.**
   Inside padding is nearly the width of the shelf gap plus half again: the card breathes
   more than the shelf does.
5. **On a phone one card owns the shelf at ~82% width with a 24px peek; on desktop two and a
   bit are visible.** Fixed card height per shelf so the row reads as a row.
6. **One radius for every card and tile.** Buttons and chips stay capsules; nothing else is.
7. **Two weights, six sizes, whole page.** If a third weight appears, something is being
   faked.
8. **The header block is one word, one promise, two exits.** No image in the header of a
   directory page; the shelves are the pictures.
9. **Fine print goes at the bottom in one dense 12px block**, longer than it looks
   reasonable. It never interrupts a shelf.

## Mapping onto Stage Times

| Store | Ours | Decision |
|---|---|---|
| `#F5F5F7` page, `#FFF` cards | `--paper` page, `--paper-sunk` cards | **Keep ours.** One-step surface change either way; direction of contrast is irrelevant. |
| `#000` featured cards | a stage-color or `--red` flood card | Keep ours — one flood per surface (`color.md` rule 3); the hero already spent it on the landing page, so no black-equivalent card on the directory. |
| Orange NEW eyebrow | `--red-deep` eyebrow text, Fragment Mono caps | **The eyebrow slot once held the "honest fan-made mark"** (retired with ADR-0005, 2026-09-22; was "FAN-MADE", `--red-deep`). Owner editions leave the eyebrow for dates and city. |
| Grey `#6E6E73` tail / footnotes | `--ink-soft` | Keep ours. |
| Blue `#0066CC` text links | `--red-deep` text button | Keep ours (`--red` fails AA under 17px; `--red-deep` is 5.6). |
| SF Pro 600 titles | Archivo expanded 600–650 | Keep ours; the expanded width is our 600. |
| 18px card radius everywhere | `--r-card` 16 and `--r-card-media` 24 | **Adopt one radius, 18px, for every card and tile** — see "Token changes." |
| 28px card padding | `--pad-card` 16 | **Adopt 28px for shelf cards** (`--pad-shelf`). The 16 stays for compact cards (the disclosure, the all-stages card). |
| 20px shelf gap | `--gap-2` 12 in the carousel | **Adopt 20px** for every shelf (`--gap-shelf`). |
| 22px gutter | `--margin` 16 | Keep 16 — measured off the phone reference; on our 320px floor 22 costs too much. |
| 82% card + 24px peek | carousel: ~86vw + ~24pt peek | Already ours. Set the card to `calc(100vw - 2*var(--margin) - 24px)` so the peek is exactly 24 — the ~86% figure in SKILL.md was the phone-screenshot approximation of the same thing. |
| Fixed 500 / 450 card height | aspect-ratio cards | **Adopt fixed height per shelf** (`--h-shelf-card`), text top, art fills the rest. |
| Text-top, art-bottom card | media card: art top, text bottom | **Adopt text-top for directory cards.** The stage cards on the subscribe page keep art-top because the headliner preview lives in the art. Two card species, one radius, one padding. |
| Bold lead + grey tail header | `.eyebrow` mono caps above a section | **Adopt the two-sentence header** for shelf sections. Eyebrows remain for card-internal labels. |
| 24 header→shelf, 64 shelf→header | `section{margin-top:--gap-6}` (40) | **Adopt** `--gap-4` (24) above a shelf and a new `--gap-section` between shelves. |
| JS scrolling, no snap | CSS `scroll-snap-type:x mandatory` | Keep ours. |
| Desktop hover paddle arrows | none | Keep none by default. Trackpads and drag scroll a snap shelf; arrows would need JS. Jake's call if desktop testing says otherwise. |
| Outlined 38px chips | filled 32px chips | Keep ours. |
| 980px content column | `--measure` 520 | **Shelves break out of the measure.** Prose stays at 520; a shelf spans `min(980px, 100vw)` with its cards at a fixed width so 2–3 show on desktop. |

### Token changes

Add to `:root` in `pages.ts` and the token block in `SKILL.md`:

```css
--r-card:        18px;   /* was 16; replaces --r-card-media 24 as well — one radius */
--pad-shelf:     28px;   /* inside a shelf card; --pad-card 16 stays for compact cards */
--gap-shelf:     20px;   /* between cards on a shelf */
--gap-section:   clamp(48px, 6vw, 64px);  /* between a shelf and the next header */
--h-shelf-card:  450px;  /* phone; 500px from 735px up */
--w-shelf-card:  calc(100vw - 2 * var(--margin) - 24px);  /* phone; 400px from 735px up */
```

**Ruled 2026-09-20: unify.** One radius, 18px, on every card and tile — the shelf cards,
the subscribe-page stage cards (from 24), and the compact cards (from 16). `--r-card-media`
is retired. The two-radius rule was inherited from Cash App's media-card exception, not
chosen; the Store's single radius is the discipline.

### The directory card, in our terms

```
┌──────────────────────────────┐  --paper-sunk, r 18, fixed height, whole card is the link
│  AUG 7–9 · SEATTLE           │  eyebrow: Fragment Mono 12 caps, --ink-soft
│                              │
│  Capitol Hill                │  title: Archivo expanded 600, 28 (phone 24), ≤ 2 lines
│  Block Party                 │
│  79 sets across 4 stages.    │  lead: 17 / 600 (Apple's 14/600 lifted to our body size)
│  Fri–Sun. Pacific time.      │  1–2 plain lines, 14 / 400, --ink-soft
│                              │
│  ░░░░░░░░░░░░░░░░░░░░░░░░░░  │  art fills to the bottom edge, no padding:
│  ░░  festival image, or  ░░  │  assets/festivals/<key>, else the Facets
│  ░░  the Facets core     ░░  │  core on the light ground (ruled; see below)
└──────────────────────────────┘
```

Section header above it: **Listed festivals.** *Add a calendar per stage.* — lead in
`--ink`, tail in `--ink-soft`, both 24 (phone) / 28, Archivo expanded 600, one line. Copy
still has to pass `copy.md`; the two-sentence pattern is a shape, not a license for
marketing tail sentences.

**The art slot, ruled 2026-09-20.** A directory card with no committed image draws the
**Facets core** from the stage art explorer (`_ref/stage-art-explorer/`): the disco ball, the
festival's own globe motif, seeded by festival key with a seeded tilt, on the light ground the
beads use. The seeded capsules (`capsuleArt()`) retire with ticket 06. A committed festival
image still wins when one exists.

Card count and order come from the ticket: every listed edition, upcoming first, nothing
unlisted or blocked. If there are fewer than two cards, the shelf still renders as a shelf
with one card at shelf width — do not fall back to the old single media card.

## Where this file does not reach

The subscribe page keeps its archetype (`screens.md` §2): art-top stage cards with the
headliner preview, the demoted all-stages card, the collapsed platform disclosure. It
inherits only the radius unification and the 20px shelf gap. The removed page and the
upload/review screens (tickets 08–10) are single-decision screens and follow SKILL.md's
"one decision per screen" rule, not this file.
