# The two screens

Stage Times has exactly two page types. Both are static, self-contained HTML with inlined CSS,
no framework, no third-party requests — fonts are same-origin woff2, art is inline SVG or a
committed image file. They get loaded on festival wifi at 2am.

## 1. Landing — `/`

Purpose: explain what this is in under five seconds and send people to a festival page. Since
ticket 06 (2026-09-20) it is the directory: one card per listed edition on a shelf
(`references/store-density.md`), earliest first festival day first, then name. Nothing unlisted
or blocked appears; the build never reads a clock, so there is no "past" and no "this weekend".

```
┌──────────────────────────────┐
│                              │  RED FLOOD (--red), full bleed — unchanged
│      STAGE TIMES             │  56–64pt / 650 / expanded caps / cream
│      Set times, by stage.    │  20pt / 500 / cream at 85%
│                              │
├──────────────────────────────┤  cream below here
│  Pick a festival. Then add   │  SECTION HEADER: two sentences on one line,
│  the stages you want.        │  bold lead in ink, quiet tail in --ink-soft,
│                              │  24 (phone) / 28, expanded 600
│  ┌────────────────────────┐┌─│  SHELF: scroll-snap x, fixed-height cards
│  │ AUG 7–9, 2026 · SEATTLE││ │  (450 phone / 500 desktop), 28pt inside,
│  │ Capitol Hill           ││ │  20pt between, one 18pt radius; a phone
│  │ Block Party            ││n│  shows one card with a 24pt peek, desktop
│  │ 79 sets across 4 stages.│e│  two and a bit. Whole card is the link;
│  │ MUNA · DISCO LINES · … ││x│  no button inside.
│  │                        ││t│
│  │ ░░ festival image, or ░││ │  ART fills the rest, edge to edge: the
│  │ ░░ the Facets core    ░││ │  committed image, else the disco ball on
│  │ ░░ (the disco ball)   ░││ │  the light ground (SKILL.md, Card art)
│  └────────────────────────┘└─│
│                              │
│  What this is                │  eyebrow, mono
│  Add one calendar per stage. │  body copy, 2 short paragraphs max — never
│  The sets show up in the     │  explain the machinery (see copy.md)
│  calendar app you already    │
│  use.                        │
│                              │
│  ─────────────────           │
│  Unofficial. Not affiliated  │  Fragment Mono, 12pt, --ink-soft
│  with any festival.          │
└──────────────────────────────┘
```

The card, top to bottom: **eyebrow** — the short dates and the city (`Aug 7–9, 2026 · Seattle`,
mono caps, `--ink-soft`; city is an optional display-only field on the festival); on a fan
edition the eyebrow slot carries the fan-made mark in `--red-deep` instead and the dates drop
to the first quiet line. **Title** — the festival name, expanded 600, 24 (phone) / 28, at most
two lines. **Lead** — one bold line, `79 sets across 4 stages.` **Quiet line** — the first
stage's billed headliners, as the data has them. Then art to the bottom edge.

The hero flood is the only place the brand shouts. Everything below it is quiet. The section
header, the first card, and the prose all share the measure's left edge; the shelf runs from
there to the right edge of the viewport. With nothing listed the shelf and its header are
omitted and the page is the hero, the prose, and the footer.

## 2. Subscribe — `/<festival-slug>-<year>/`

The screen is still called the subscribe page in the repo and the URL space. **The button on it
says "Add calendar"** — ruled 6 Sep 2026, see `copy.md`. The live page still reads "Subscribe"
until ticket 15 applies the copy rewrites; the diagram below is the target.

Purpose: get one tap from "I care about this stage" to "it's in my calendar." This is the entire
product. Every design decision here is subordinate to that tap.

```
┌──────────────────────────────┐
│  (◀)                         │  44pt circle icon button, --paper-sunk, top-left
│                              │
│  STAGE TIMES                 │  wordmark lockup: 14pt expanded caps, --red
│  Capitol Hill Block Party    │  40pt / 630 expanded — screen title, ink on cream
│  FRI 7 – SUN 9 AUG · 79 SETS │  mono caption, --ink-soft
│                              │
│  PICK YOUR STAGES            │  eyebrow, mono
│ ┌───────────────────┐┌────── │  CAROUSEL — scroll-snap x, card ~86vw,
│ │ ·  ·  beads   ·   ││       │  next card peeks ~24pt, no scrollbar
│ │ ·  FRIDAY·10:40PM ││ next  │  the beads: a ring per day, a bead per
│ │ ·     MUNA      · ││ stage │  set; the headliner names cycle in the
│ │  ·   ·   ✦   ·    ││       │  center as a poster block, ink on the
│ │      ·   ·        ││       │  light ground (SKILL.md, Card art)
│ │                   ││       │
│ │ Main Stage        ││       │  28–30pt / 600 expanded, cream
│ │ 24 SETS · FRI–SUN ││       │  mono caption, cream 85%
│ │ [ Add calendar ] (⧉)││      │  cream pill + 44pt icon button (copy link)
│ └───────────────────┘└────── │
│                              │
│  ┌────────────────────────┐  │
│  │ All stages             │  │  --paper-sunk card, ink text, full width —
│  │ 96 sets · every stage  │  │  visually demoted below the carousel
│  └────────────────────────┘  │
│                              │
│  Not on iPhone?              │  disclosure section, collapsed by default
│  ▸ Google Calendar           │
│  ▸ Outlook                   │
│                              │
│  ─────────────────           │
│  Updated 8 Aug 2026          │  Fragment Mono footer
│  Source: official schedule ↗ │
│  Found an error? ↗           │
└──────────────────────────────┘
```

One stage card owns the viewport at a time — that's the "single content in the viewport" rule
made literal. The subscribe page has **no red flood** (the landing hero already spent it; one
flood per *product surface*, and cream keeps the stage colors loud). The carousel is pure CSS
scroll-snap; the peeking next card is the entire affordance and there are no dots, no arrows,
no JS scroll handling.

### Card order is a product decision

Per-stage cards come first and get color. `all.ics` comes last, uncolored, in a sunk-grey card.
The brief's whole argument is that subscribing to two or three stages beats subscribing to
everything — the visual hierarchy has to make the same argument. Do not put `all.ics` at the top
just because it sorts first alphabetically.

### The platform-honesty section

The brief requires stating plainly that Google Calendar cannot subscribe by URL from its mobile
apps. Design this as a **collapsed disclosure**, not a banner:

- An iPhone user taps Add calendar and never sees it. Correct — they're the happy path.
- An Android user who taps Add calendar and gets nothing goes looking for exactly this, finds it
  immediately, and reads the literal menu path: *Settings → Add calendar → From URL*.
- A warning banner at the top would tax 80% of users to inform 20%.

Each disclosure body contains the exact `https://` URL in a monospace block with a copy button.
Not a `webcal://` link — that's what silently no-ops on Android.

### Overlap caveat

One sentence, in the footer region, in `--ink-soft`: *"Two or three stages reads well in a day
view. Eight compresses into unreadable columns — use the official grid for the full lineup."*
Honest, brief, not a modal, not a checkbox.

## What neither screen has

No search. No filters. No login. No dark mode toggle (respect `prefers-color-scheme` and stop).
No cookie banner — there are no cookies. No third-party script (the same-origin Vercel Web
Analytics snippet is the one owner-approved exception). No share sheet. No "add to home screen"
prompt. No countdown timer.

A festival-goer opens this page once, taps two or three times, and never returns. Every feature
that assumes a second visit is dead weight.

## 3. Upload — `/upload/`

The third page type (ticket 08, 2026-09-20). One static page, five screens shown one at a time
by a small script, so the image never leaves the phone's memory between screens. Everything the
flow *decides* is in `src/publisher.ts`; the page repeats the publisher's own sentence for every
rejection and holds no rule of its own. Markup and copy in `src/upload-pages.ts`.

```
┌──────────────────────────────┐
│  (◀)                         │  the same top bar and lockup as the subscribe page
│  STAGE TIMES                 │
│  Add a festival              │  40pt / 630 expanded — the title stays across screens
│  FROM ONE SCREENSHOT OF …    │  mono caption
│                              │
│  Festival                    │  1. DETAILS — four fields (festival, first day,
│  [                    ]      │     last day, email), 52pt / 8pt radius, sunk fill:
│  First day     Last day      │     the one non-capsule control. Email hint says it
│  [        ]    [        ]    │     is a contact, not an account.
│  Email                       │
│  [                    ]      │
│  [        Next        ]      │  one primary pill
│                              │
│  Your screenshot             │  2. UPLOAD — one line saying what to pick, one
│  [    Choose image    ]      │     file pill. "Reading…" + a mono status line while
│                              │     the model reads; a yellow line for any rejection.
│                              │
│  Check every set             │  3. REVIEW — the uploader's image in a card, then
│  ┌────────────────────────┐  │     the time zone as a guess (select, spoken names),
│  │   their image          │  │     then a row list per stage: artist field, day +
│  └────────────────────────┘  │     two time fields, the printed time in mono,
│  Time zone [Pacific      ▾]  │     yellow chips for "End is a guess" and "Look
│  MAIN STAGE                  │     closer", and a tonal "Can't read it" toggle.
│  [ MUNA               ]      │     No dividers. Confirm is disabled with a plain
│  FRI [10:40 PM]–[11:40 PM]   │     reason while any set is marked.
│  FRI · Printed 10:40-CLOSE   │
│  (End is a guess)            │
│  [ Can't read it ]           │
│  [       Confirm      ]      │
│                              │
│  Building your page          │  4. PUBLISHING — the honest wait: times are saved,
│  Checking every few seconds. │     the page is building. The update link is handed
│  YOUR UPDATE LINK            │     over here, not after, with a copy icon button.
│  [https://…/update/…] (⧉)    │
│                              │
│  It's live                   │  5. SUCCESS — share link, update link, one line
│  YOUR PAGE                   │     saying which to keep, one pill: Open your page.
│  [https://…/fan/…/   ] (⧉)   │     After five minutes without an answer the heading
│  YOUR UPDATE LINK            │     is "Nearly there" and the links are still shown.
│  [https://…/update/…] (⧉)    │
│  [    Open your page   ]     │
└──────────────────────────────┘
```

Rules that came out of building it:

- **A rejection lands on the screen that can fix it.** A typo goes back to the form; anything
  about the image, and the caps, go back to the file pill; a review that will not build stays on
  review. `GATE_SCREENS` in `src/upload-pages.ts` is the map, and the script carries it verbatim.
- **The browser checks what it can before it posts** — type and the short edge — with the
  publisher's own numbers, and shrinks a photo to fit the platform's body cap. A screenshot never
  needs shrinking. The same bytes go to upload and to confirm.
- **The update link is shown while the page builds**, not only on success. Once confirm answers,
  the secret exists nowhere but this tab; a two-minute wait is the wrong place to hold it.
- **The wait is real.** The script asks for the edition's own calendar until it answers, and says
  so in a sentence when it stops trying. Nothing on this page says "done" before it is.
- **Glossary words stay off the page.** Screens say "your page", "your update link", "the times",
  "a guess" — never edition, feed, transcription, verified, or a zone id.
