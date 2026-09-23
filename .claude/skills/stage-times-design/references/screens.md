# The screens

Stage Times has three page types — landing, subscribe, and upload — plus the removed page a
blocked edition serves in place of its subscribe page (copy.md). All are static, self-contained
HTML with inlined CSS, no framework, no third-party requests — fonts are same-origin woff2, art
is inline SVG or a committed image file. They get loaded on festival wifi at 2am.

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
│  │ ░░ the festival's own ░││ │  ART fills the rest, edge to edge: the
│  │ ░░ art, committed     ░││ │  festival's committed art; no art, no
│  │ ░░                    ░││ │  card yet (SKILL.md, Card art)
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
mono caps, `--ink-soft`; city is an optional display-only field on the festival). No card says
whose it is: every edition is the owner's (ADR-0005). **Title** — the festival name, expanded 600, 24 (phone) / 28, at most
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

### Two weekends: pick the weekend, then the stages

A festival that runs twice (ACL, Coachella; `CONTEXT.md`: weekend) is one page. Under the
title, an eyebrow `PICK YOUR WEEKEND` over two tonal pills side by side, 8pt apart, `Weekend 1`
and `Weekend 2`, the pressed one ink. Below, the pressed weekend's eyebrow — `WEEKEND 2 · FRI 9
OCT – SUN 11 OCT` — and its carousel of stage cards, exactly the single-weekend carousel. The
other weekend's carousel is in the page, hidden; the pills are anchors, so with no script both
weekends show in order and a pill scrolls to its weekend. A stage that plays both weekends is
two cards, one per weekend, in the **same color** — color is identity (`references/color.md`),
so the color is assigned by the stage's position within its own weekend. The title caption
takes the card's short dates, `OCT 2–4 & OCT 9–11, 2026`, and counts a stage once. The all-stages
card says `every stage, both weekends, in one calendar`. Each weekend stage's calendar is named
with its weekend, `T-Mobile (Weekend 1) — ACL 26`, so two calendars for one stage read apart in
the list. Ticket 22, 2026-09-22.

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

## What no screen has

No search. No filters. No login. No dark mode toggle (respect `prefers-color-scheme` and stop).
No cookie banner — there are no cookies. No third-party script (the same-origin Vercel Web
Analytics snippet is the one owner-approved exception). No share sheet. No "add to home screen"
prompt. No countdown timer.

A festival-goer opens a festival page once, taps two or three times, and never returns. Every
feature that assumes a second visit is dead weight.

## 3. Upload — `/upload/`

The third page type (ticket 08, 2026-09-20), and the owner's alone since ADR-0005: every screen
ships hidden, and without the bookmark's secret the script sends the visitor home before one
shows. One static page, six screens shown one at a time by a small script, so the image never leaves the phone's memory between screens. Everything the
flow *decides* is in `src/publisher.ts`; the page repeats the publisher's own sentence for every
rejection and holds no rule of its own. Markup and copy in `src/upload-pages.ts`.

```
┌──────────────────────────────┐
│  (◀)                         │  the same top bar and lockup as the subscribe page
│  STAGE TIMES                 │
│  Add a festival              │  40pt / 630 expanded — the title stays across screens
│  FROM THE FESTIVAL'S SCHED…  │  mono caption: both doors, the link first
│                              │
│  Schedule page               │  0. LINK (ticket 20) — the front door: the festival's
│  [ https://            ]     │     schedule page and an email, one primary pill
│  Email                       │     ("Read the times"), and a text button to the
│  [                    ]      │     screenshots ("Use screenshots"). Nothing else is
│  [    Read the times   ]     │     typed. The read is the same drawn wait as an
│  Use screenshots             │     upload's, with the link's own steps first
│                              │     (opening the page, the images found — the rings
│                              │     follow the count). Every answer to a link lands
│                              │     back here in the publisher's sentence, the
│                              │     screenshots one tap away.
│                              │
│  Festival                    │  1. DETAILS — the screenshot flow's own first screen,
│  [                    ]      │     one tap from the link: four fields (festival,
│  First day     Last day      │     first day, last day, email), 52pt / 8pt radius,
│  [        ]    [        ]    │     sunk fill: the one non-capsule control. Email
│  Email                       │     hint says it is a contact, not an account. "Use
│  [                    ]      │     a link" under Next is the way back.
│  [        Next        ]      │  one primary pill
│                              │
│  Your screenshot             │  2. UPLOAD — one line saying what to pick. A one-day
│  [    Choose image    ]      │     festival: one file pill, posting on choose.
│                              │     "Reading…" + a mono status line while the model
│  Your screenshots            │     reads; a yellow line for any rejection.
│  (▣) FRI 9 OCT               │     More days (ticket 18): a row per day — 56pt tile,
│      Swap image              │     the day in caption caps, "Choose image" — every
│  (▣) SAT 10 OCT              │     day shown from the start so the shape is clear,
│      Swap image              │     tap a filled row to swap; one pill reads whatever
│  ( ) SUN 11 OCT              │     is chosen, and a mono line says a day with no
│      Choose image            │     times can be left out. A rejection about one
│  [   Read the times   ]      │     image is a yellow line under that day's row, in
│  ┌────────────────────────┐  │     the publisher's words.
│  │ · ·  the beads  · ·    │  │     While it reads: the beads with no sets yet (a
│  │   ·  filling in   ·    │  │     ring per day, beads filling in and dissolving,
│  └────────────────────────┘  │     rings drifting) on the light red ground, in the
│  READING THE ARTIST NAMES …  │     art slot of a card, over a mono status line —
│                              │     what is being read and how many; after fifteen
│                              │     seconds, how long it has been. Same while saving.
│                              │
│  Does this look right?       │  3. REVIEW — one heading for both doors. After a
│  Festival [ Low Tide     ]   │     link (ticket 20), the name and each day as read,
│  WEEKEND 1                   │     as fields, the days labeled with the weekday that
│  FRIDAY [Oct 2] SATURDAY [ ] │     date falls on (a wrong year shows as the wrong
│  SUNDAY [ ]                  │     weekday) and grouped a weekend at a time when
│  WEEKEND 2                   │     there is more than one; the year is the first
│  FRIDAY [Oct 9] SATURDAY [ ] │     day's, and moving it moves every day. Then the
│  SUNDAY [ ]                  │     address the page will live at, following the name
│  The page will be …/acl-…/   │     and that year as typed. After screenshots the
│                              │     header is what was typed, unshown. Then the time
│  Time zone [Central      ▾]  │     zone (select, spoken names): the festival's own
│  Where this festival is held.│     when it is on record in the almanac, else a guess
│                              │     and said so. Then one section per image, in day
│  WEEKEND 1 · FRI 2 OCT       │     order: its day as an eyebrow (only with several,
│  ┌────────────────────────┐  │     with its weekend), the image in a card, a count
│  │   their Friday image   │  │     ("34 sets read, 1 flagged."), then the flagged
│  └────────────────────────┘  │     rows only — the lines the model said it was
│  34 sets read, 1 flagged.    │     unsure of, and nothing else — by stage, and one
│  TITO'S HANDMADE VODKA       │     text button that shows the rest. A row: artist
│  [ ¥OU$UK€ ¥UK1MAT$U   ]     │     field, day + two time fields, the printed time
│  SAT [6:30 PM]–[7:30 PM]     │     in mono, the yellow "Look closer" chip, the
│  SAT · Printed 6:30 – 7:30   │     model's own few words why, and a tonal "Looks
│  (Look closer)               │     good" that folds the row away. A guessed end is
│  stylized glyphs; could be…  │     shown as the calendar will have it and the
│  [ Looks good ]              │     printed line says "No end printed · 90 min
│  Show all 34 sets            │     guess" — it is not a flag. A row's day is the
│  WEEKEND 1 · SAT 3 OCT       │     night it belongs to (a 1 AM set is Friday's).
│  …                           │     No dividers. Nothing blocks confirm.
│  [       Confirm      ]      │
│                              │
│  Building the page           │  4. PUBLISHING — the honest wait: times are saved,
│  Checking every few seconds. │     the page is building.
│                              │
│  It's live                   │  5. SUCCESS — the page link with a copy icon
│  On the homepage now.        │     button, one pill: Open the page. After five
│  THE PAGE                    │     minutes without an answer the heading is "Nearly
│  [https://…/acl-…/   ] (⧉)   │     there" and the link is still shown.
│  [    Open the page    ]     │
└──────────────────────────────┘
```

Rules that came out of building it:

- **A rejection lands on the screen that can fix it.** A typo goes back to the form; anything
  about the image goes back to the file pill; a review that will not build stays on
  review. `GATE_SCREENS` in `src/upload-pages.ts` is the map, and the script carries it verbatim.
- **The browser checks what it can before it posts** — type and the short edge — with the
  publisher's own numbers, and shrinks an image to its share of the platform's body cap: one post
  carries every day, so three days of screenshots share what one screenshot had to itself. The
  same bytes go to upload and to confirm.
- **One day is one tap fewer.** With one day between the dates there is no row and no read pill:
  choosing the image is the read, exactly as before ticket 18. The rows only appear when there
  is more than one day to give an image to.
- **The wait says what it is doing and how long it has been, and draws itself.** The browser
  cannot see the model's progress, so the status line names the step in the reader's words
  ("Reading the artist names and times off your 3 images, one after the other") and, after
  fifteen seconds, counts the seconds — the one thing it knows. The art is the stage card's
  beads with no sets yet (`loadingArt()`): a ring per day, beads filling in and dissolving,
  under reduced motion the finished ring. Nothing on it is random.
- **A rejection never strands the reader.** A review-gate rejection with nothing reviewed lands
  on the images, not on an empty review; Confirm with nothing to confirm goes back. A source
  with no web address printed on it (the schema needs one) lands on the form as the `link`
  gate, revealing a single "Schedule link" field that is otherwise hidden — the form stays three
  fields when the poster prints its address.
- **The wait is real.** The script asks for the edition's own calendar until it answers, and says
  so in a sentence when it stops trying. Nothing on this page says "done" before it is.
- **Glossary words stay off the page.** Screens say "the page", "the times",
  "a guess" — never edition, feed, transcription, verified, or a zone id.
- **The link is the front door; the screenshots are one tap away, unchanged** (ticket 20). The
  link screen asks for one thing and nothing about the festival — name, year and days come off
  the page and are checked on review, where the address updates as the name is typed so a
  misread name is caught before it is permanent. Every answer to a link, whatever its gate, lands
  back on the link screen: it is the only screen that came before it.

- **The flagged sets are the review; the rest wait behind one tap per day** (owner feedback,
  2026-09-22). Two hundred rows is a page nobody checks. Each day counts its sets and its
  flags, shows only those rows, and offers "Show all N sets". Confirm still reads every row,
  shown or not, and is still the human's act (the no-draft-tier ruling): what changed is what
  the human is asked to look at. **A flag is the model's own doubt, nothing else** (second
  round, same day): the vision reply carries `unsure` per set, filled only when the model could
  not read that line with confidence, and the review flags exactly those — with the model's few
  words under the row and one tonal "Looks good" that folds it away. A name that merely looks
  odd, a note in the observations, and a missing end are not flags; on the ACL read that took
  35 flags to about one a day. "Can't read it" is gone: nothing on the review blocks confirm,
  and the fix for a wrong line is the fields. **A missing end is guessed, shown, and said so**:
  90 minutes for the last set printed on its stage that day (the closer, which is who gets no
  end printed), 60 for any other, in the end field as the calendar will have it, with "No end
  printed · 90 min guess" on the printed line; a moved start carries the guess with it. The
  same feedback dropped the Year field (each day carries its year; the first day's is the
  festival's), grouped the days a weekend at a time, put a link's images into day order
  whatever order the page listed them, left a guessed end blank with "No end printed" or "Til
  close" instead of an invented time, and read the zone off the almanac
  (`config/festivals.yaml`, matched by the schedule page's host or the printed name — Central
  for ACL) with "Where this festival is held." under the select instead of "A guess".

### No update link's page

Until ADR-0005 (2026-09-22) each fan edition had a page at `/update/fan/<key>/` for its
uploader to fix a time or take it down. Nobody but the owner publishes now, so neither the page
nor the link exists; the owner corrects through the watcher's review or the YAML.
