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
   The reference is screenprint: ink either touches the paper or it doesn't.
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

Each stage feed gets one color, used on its card and its subscribe button, so a stage is
recognizable at a glance and matches whatever color the user later assigns the calendar in iOS.
Extend the four brand hues with values that hold the same flat screenprint character — saturated,
mid-dark, no pastels:

```css
--stage-1: #EC300C;  /* red      — 4.0 on cream, large text only */
--stage-2: #045CAC;  /* blue     — 6.4 */
--stage-3: #1F7A4C;  /* green    — 5.1 */
--stage-4: #B5307A;  /* magenta  — 5.5 */
--stage-5: #A85100;  /* orange   — 5.2 */
--stage-6: #5B3FA8;  /* violet   — 7.4 */
--stage-7: #0C6B78;  /* teal     — 5.9 */
--stage-8: #8A1B2E;  /* oxblood  — 8.8 */
```

Assign by stage order in the YAML and freeze the assignment — a stage that changes color between
years is worse than one that never had a color. All eight take cream (`--paper`) as foreground;
all clear 4.5:1 except `--stage-1`, which inherits red's large-text-only restriction. Yellow is
deliberately absent from this list — it cannot carry cream text at any size.

Never encode meaning in stage color beyond identity. Color is a label, not a signal — do not use
red to mean "sold out" or green to mean "confirmed" anywhere in this product.
