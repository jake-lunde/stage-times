# The two screens

Stage Times has exactly two page types. Both are static, self-contained HTML with inlined CSS,
no framework, no external requests, no webfonts — they get loaded on festival wifi at 2am.

## 1. Landing — `/`

Purpose: explain what this is in under five seconds and send people to the festival page.

```
┌──────────────────────────────┐
│                              │  RED FLOOD (--red), full bleed
│      STAGE TIMES             │  48pt / 800 / cream, tight tracking
│      Set times, by stage.    │  20pt / 500 / cream at 80%
│                              │
├──────────────────────────────┤  cream below here
│                              │
│  [ ThatFest 2026        → ]  │  full-width row card, 72pt tall
│    Aug 14–16 · 6 stages      │
│                              │
│  What this is                │  section header
│  Subscribe to one calendar   │  body copy, 3 short paragraphs max
│  per stage. Your calendar     │
│  app does the rest.          │
│                              │
│  ─────────────────           │
│  Unofficial. Not affiliated  │  --ink-soft, 13pt
│  with any festival.          │
└──────────────────────────────┘
```

The hero flood is the only place the brand shouts. Everything below it is quiet.

## 2. Subscribe — `/<festival-slug>-<year>/`

Purpose: get one tap from "I care about this stage" to "it's in my calendar." This is the entire
product. Every design decision here is subordinate to that tap.

```
┌──────────────────────────────┐
│  ← ThatFest 2026             │  nav bar, 44pt, back arrow left
├──────────────────────────────┤
│                              │
│  ThatFest 2026               │  34pt / 800 — screen title, left-aligned
│  Aug 14–16 · Chicago         │  17pt / --ink-soft
│                              │
│  ┌────────────────────────┐  │
│  │ MAIN STAGE             │  │  stage card, --stage-N flood
│  │ 24 sets · Fri–Sun      │  │  cream 17pt semibold (large-text rule)
│  │                        │  │
│  │ [   Subscribe    ]     │  │  cream pill on colored card
│  │ Copy link              │  │  cream text button
│  └────────────────────────┘  │
│                              │  20pt gap
│  ┌────────────────────────┐  │
│  │ THE GROVE              │  │  next stage, next color
│  └────────────────────────┘  │
│         ⋮                    │
│                              │
│  ┌────────────────────────┐  │
│  │ All stages             │  │  --paper-sunk card, ink text — visually
│  │ 96 sets · every stage  │  │  demoted below the per-stage cards
│  └────────────────────────┘  │
│                              │
│  Not on iPhone?              │  disclosure section, collapsed by default
│  ▸ Google Calendar           │
│  ▸ Outlook                   │
│                              │
│  ─────────────────           │
│  Updated 8 Aug 2026          │  --ink-soft footer
│  Source: official schedule ↗ │
│  Found an error? ↗           │
└──────────────────────────────┘
```

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
No cookie banner — there are no cookies. No analytics script. No share sheet. No "add to home
screen" prompt. No countdown timer.

A festival-goer opens this page once, taps two or three times, and never returns. Every feature
that assumes a second visit is dead weight.
