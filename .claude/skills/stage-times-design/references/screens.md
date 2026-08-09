# The two screens

Stage Times has exactly two page types. Both are static, self-contained HTML with inlined CSS,
no framework, no third-party requests — fonts are same-origin woff2, art is inline SVG or a
committed image file. They get loaded on festival wifi at 2am.

## 1. Landing — `/`

Purpose: explain what this is in under five seconds and send people to the festival page.

```
┌──────────────────────────────┐
│                              │  RED FLOOD (--red), full bleed
│      STAGE TIMES             │  56–64pt / 650 / expanded caps / cream
│      Set times, by stage.    │  20pt / 500 / cream at 85%
│                              │
├──────────────────────────────┤  cream below here
│  ┌────────────────────────┐  │
│  │                        │  │  MEDIA CARD, 24pt radius, --paper-sunk
│  │   [festival image or   │  │  image area edge-to-edge, no padding
│  │    procedural art]     │  │  (assets/festivals/<key>.<ext>)
│  │                        │  │
│  │  AUG 7–9 · SEATTLE     │  │  eyebrow, mono, 12pt caps
│  │  Capitol Hill          │  │  34pt / 600 / expanded — big and light
│  │  Block Party           │  │
│  │  79 sets · 4 stages  [See stages] │  footer row: mono meta left, pill right
│  └────────────────────────┘  │
│                              │
│  What this is                │  eyebrow, mono
│  Subscribe to one calendar   │  body copy, 3 short paragraphs max
│  per stage. Your calendar    │
│  app does the rest.          │
│                              │
│  ─────────────────           │
│  Unofficial. Not affiliated  │  Fragment Mono, 12pt, --ink-soft
│  with any festival.          │
└──────────────────────────────┘
```

The hero flood is the only place the brand shouts. Everything below it is quiet. The festival
card is the Apple Store product card: image first, light-weight big heading, one pill. The whole
card is tappable (and shrinks on press); the pill is the same link restated.

## 2. Subscribe — `/<festival-slug>-<year>/`

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
│ │ ░░ procedural ░░  ││       │  next card peeks ~24pt, no scrollbar
│ │ ░░ capsule art ░░ ││ next  │
│ │  NIMINO           ││ stage │  headliner preview in the art area,
│ │  MARIAH CAREY     ││       │  cream ≥17pt semibold
│ │  TURNSTILE        ││       │
│ │                   ││       │
│ │ Main Stage        ││       │  28–30pt / 600 expanded, cream
│ │ 24 SETS · FRI–SUN ││       │  mono caption, cream 85%
│ │ [ Subscribe ] (⧉) ││       │  cream pill + 44pt icon button (copy link)
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

- An iPhone user taps Subscribe and never sees it. Correct — they're the happy path.
- An Android user who taps Subscribe and gets nothing goes looking for exactly this, finds it
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
