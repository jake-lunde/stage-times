# Color

Derived from `_ref/color-reference/` — the Fritz Coffee Company mark: a four-color retro
screenprint. Cream paper, vermillion red, golden yellow, deep royal blue. Flat, no gradients,
no shadows, colors that sit on the paper rather than float above it.

Sampled hex values (dominant pixel per hue family, JPEG-corrected to round numbers):

| Role | Sampled | Token value | Notes |
|---|---|---|---|
| Paper | `#FCF9F4` | `#FCF9F4` | Warm off-white. This is the background, not `#FFF`. |
| Red | `#EC300C` | `#EC300C` | Vermillion. The action color. |
| Yellow | `#ECCC0C` | `#ECCC0C` | Golden, not lemon. Highlight only — never a text color. |
| Blue | `#045CAC` | `#045CAC` | Deep royal. Structural / secondary. |
| Ink | — | `#12181F` | Not in the reference; needed for body text. Near-black with a blue cast so it reads as printer's ink on the warm paper, never as pure `#000`. |

## The substitution

Cash App floods green and prints black on white. Stage Times floods **red** and prints **ink on
cream**. Everything else about the structure carries over unchanged — this is a palette swap on a
borrowed skeleton, not a different design language.

| Cash App | Stage Times |
|---|---|
| Green `#00D64F` flood on the money screen | Red `#EC300C` flood on the hero |
| Black pill primary button | Red pill primary button |
| Light-grey tonal secondary button | Blue-tinted tonal secondary button |
| White `#FFF` page background | Cream `#FCF9F4` page background |
| Grey `#F5F5F5` card fill | Warm sand `#F2EDE4` card fill |
| Yellow chip accent (`7 offers →`) | Yellow chip accent, same job |

## Tokens

```css
:root {
  /* paper */
  --paper:        #FCF9F4;  /* page background */
  --paper-sunk:   #F2EDE4;  /* cards, tonal buttons, inset rows */
  --paper-line:   #E5DED1;  /* dividers, 1px card borders */

  /* ink */
  --ink:          #12181F;  /* primary text */
  --ink-soft:     #6B6459;  /* secondary text, captions, metadata */
  --ink-faint:    #A79E90;  /* disabled, placeholder */

  /* brand */
  --red:          #EC300C;  /* primary action, hero flood */
  --red-deep:     #C42408;  /* pressed state */
  --red-wash:     #FCE4DD;  /* red tonal fill */
  --blue:         #045CAC;  /* secondary action, links, structure */
  --blue-deep:    #033F78;
  --blue-wash:    #DCE7F4;
  --yellow:       #ECCC0C;  /* highlight chip, never text */
  --yellow-wash:  #FBF2C8;

  /* on-color text */
  --on-red:       #FCF9F4;
  --on-blue:      #FCF9F4;
  --on-yellow:    #12181F;  /* yellow takes ink, never white */
}
```

## Rules

1. **Never pure white or pure black.** `#FFF` on cream reads as a bug; `#000` reads as harsh
   against warm paper. Use `--paper` and `--ink`.
2. **Yellow never carries text.** `#ECCC0C` on ink passes contrast but reads as a warning label.
   Yellow is a background for short ink-colored labels (a count, a "NEW" badge) and nothing else.
3. **One flood per screen.** A screen is either cream-with-red-accents or red-flooded. Never both
   halves. Cash App's green keypad screen works because green owns the entire viewport — a red
   band across the top third would just look like an error state.
4. **Flat only.** No gradients, no drop shadows, no blur. Elevation is expressed with
   `--paper-sunk` fill and, where a boundary is genuinely needed, a 1px `--paper-line` border.
   The reference is screenprint: ink either touches the paper or it doesn't. The card art area
   is exempt (owner ruling, 2026-09-20; see `SKILL.md` non-negotiable 3): glow lives there and
   nowhere else.
5. **Contrast floor** (measured, not estimated):

   | Pair | Ratio | Verdict |
   |---|---|---|
   | `--ink` on `--paper` | 17.0 | any size |
   | `--ink-soft` on `--paper` | 5.6 | any size |
   | `--ink-faint` on `--paper` | 2.5 | **decorative only** — placeholder/disabled, never real content |
   | `--paper` on `--red` | 4.0 | **large text only** (≥17pt semibold / ≥24pt regular) |
   | `--paper` on `--blue` | 6.4 | any size |
   | `--ink` on `--yellow` | 11.2 | any size |
   | `--red` on `--paper` | 4.0 | **large text only** — use `--red-deep` (5.6) for anything smaller |

   The consequence worth internalizing: **cream-on-red only works at button-label size and up.**
   A red card can carry a 22pt stage name in cream, but its 15pt subtitle must move to a cream
   surface or drop to a darker red. This is the one place the reference palette fights the
   interface, and the resolution is always "make the text bigger," never "make the text greyer."

## Per-stage colors

Each stage gets one color, on its card and on its calendar, so a stage is recognizable at a
glance and its calendar arrives the same color as its card. **The festival's own colors come
first** (owner ruling, 2026-09-23): sampled off its art with `npm run palette -- <key>` and
listed under `festival: colors:` in the edition YAML, one per stage in the order a weekend lists
them. `src/colors.ts` is the one place a stage's color is decided; the page and the feed both
read it.

**Light colors keep their brightness and print ink** — the way the festival's poster prints them —
rather than being darkened until cream passes. The text on a stage color is cream when cream
clears 4.5:1 on it and ink otherwise (`textOn()`), and the whole card follows: an ink card has
ink type at full strength, an ink pill with a cream label, an ink-wash copy button, and ink beads
on its art ground. A color neither cream nor ink clears 4.5:1 on is refused by the schema; take a
lighter or darker shade of it off the art. Sample exact pixels, never averages: ACL's hot pink
averaged to `#FC004C` (ink 4.46:1, refused), and the pixel off the art is `#FF004B` (4.55:1).

An edition with no `colors:`, or fewer than a weekend's stages, takes the house colors for every
stage — never a mix of the two. The house colors hold the brand's flat screenprint character —
saturated, mid-dark, no pastels — and all take cream at 4.5:1 or better:

```css
--stage-1: #C42408;  /* red      — 5.5 (the hero's #EC300C is 4.0, large text only) */
--stage-2: #045CAC;  /* blue     — 6.4 */
--stage-3: #1F7A4C;  /* green    — 5.1 */
--stage-4: #B5307A;  /* magenta  — 5.5 */
--stage-5: #A85100;  /* orange   — 5.2 */
--stage-6: #5B3FA8;  /* violet   — 7.4 */
--stage-7: #0C6B78;  /* teal     — 5.9 */
--stage-8: #8A1B2E;  /* oxblood  — 8.8 */
```

Yellow is deliberately absent from the house list — it cannot carry cream text at any size. A
festival's yellow can: it prints ink.

**The color is in the feed.** Each stage calendar carries `X-APPLE-CALENDAR-COLOR:#RRGGBB`
(`all.ics` carries none). Apple Calendar on macOS takes it as the calendar's color when the
calendar is added — checked 23 Sep 2026 against two colors that are not Apple defaults. Google
and Outlook read no color from a feed. RFC 7986's `COLOR` is left out: its value is a CSS color
name, and a festival's colors are not names.

Settle an edition's colors before it is published and then leave them: a calendar app takes the
color when the calendar is added, and nothing says it follows a later change, so count on a
change reaching the page and new subscribers only. A stage that changes color between years is
worse than one that never had a color.

Never encode meaning in stage color beyond identity. Color is a label, not a signal — do not use
red to mean "sold out" or green to mean "confirmed" anywhere in this product.
