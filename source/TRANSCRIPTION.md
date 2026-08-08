# Transcription log — Capitol Hill Block Party 2026

Source images: `_ref/set-screenshots/CHBP+Daily+Schedule_SATURDAY.webp`, `…_SUNDAY.webp`
(1000×1333 each). Every column was cropped and re-read at 2× before transcription; nothing
below is a single-pass read.

Verified independently: **2026-08-08 is a Saturday** and **2026-08-09 is a Sunday**, matching the
poster headers. Seattle is **PDT (UTC−7)** across the whole festival — no DST transition falls
inside the window, so gate 5's DST case is exercised by a separate fixture, not by this data.

---

## Verbatim transcription

Times are exactly as printed. `CLOSE` is reproduced literally — it is not a time.

### SATURDAY AUGUST 8, 2026

**MAIN STAGE**
```
SLOANE MOTION        2:45-3:15PM
MGNA CRRRTA          3:45-4:30PM
MOMMA                5:00-5:45PM
JIGITZ               6:15-7:00PM
AMBER MARK           7:30-8:30PM
TINASHE (DJ SET)     9:00-10:00PM
DISCO LINES          10:40-CLOSE
```

**DAYDREAM STAGE**
```
MAKENNA DECARO       2:20-2:50PM
OXIS                 3:20-4:05PM
NICKCHEO             4:35-5:20PM
WHATMORE             5:50-6:35PM
NIGHT TAPES          7:05-7:50PM
MALLRAT              8:20-9:20PM
ROCHELLE JORDAN      10:00-11:00PM
```

**NEUMOS STAGE**
```
TINY MONSTERS        4:00-4:45PM
SAMARA LENNOXX       5:15-6:00PM
KENSHI KILLZZZ       6:30-7:15PM
THE REQUISITE        7:45-8:30PM
VIKA & THE VELVETS   9:00-9:45PM
RUB                  10:15-11:00PM
AFTERS: NICKCHEO     11:15-CLOSE
```

**BARBOZA STAGE**
```
ROSE PEAK                      4:15-4:45PM
THE FLOOR IS NOT LAVA          5:15-5:45PM
SLONE                          6:15-6:45PM
POACHED                        7:15-7:45PM
PINK STEAM                     8:15-8:45PM
J.HENRY                        9:15-9:45PM
BAZAAR                         10:15-10:45PM
AFTERS: DJ_DAVE + MGNA CRRRTA  (DJ SETS)  11:00-CLOSE
```

### SUNDAY AUGUST 9, 2026

**MAIN STAGE**
```
INSTANT CRUSH        1:45-2:15PM
DJ_DAVE              2:45-3:15PM
HAUTE & FREDDY       3:55-4:40PM
ZACK FOX             5:20-6:20PM
PARCELS              7:00-8:00PM
WET LEG              8:40-CLOSE
```

**DAYDREAM STAGE**
```
CAL STATE FOOTBALL STADIUM     2:30-3:00PM
RAINBOW JACKSON                3:30-4:00PM
BABYMOROCCO                    4:30-5:15PM
AVALON EMERSON & THE CHARM     5:55-6:40PM
LUCY BEDROQUE                  7:20-8:20PM
MPH                            9:00-CLOSE
```

**NEUMOS STAGE**
```
BEACH VACATION                          4:15-4:45PM
JOHN-ROBERT                             5:30-6:00PM
PLUGGED IN!                             6:30-7:15PM
WORK WIFE                               7:45-8:30PM
CLOUDS OF THE WEST                      9:00-9:45PM
AFTERS: DJ100PROOF + THE LAST SKEPTIK   10:00-CLOSE
```

**BARBOZA STAGE**
```
SCOTT YODER          4:30-5:00PM
DSRT FLWR            5:30-6:00PM
RODNEY TRISTAN       6:30-7:00PM
MIDDLE NAMES         7:30-8:00PM
HENRY MANSFIELD      8:30-9:00PM
FATAL FEMMES         9:30-10:00PM
```

**Totals:** 29 Saturday (7 main + 7 daydream + 7 neumos + 8 barboza) + 24 Sunday (6 per stage)
= **53 sets** across 4 stages. This matches the count the build reports; if the two ever diverge,
the build is right and this document is stale.

---

## Ambiguities — every one of these needs a human decision before publish

### 1. Friday is missing — BLOCKING for a complete feed
Only Saturday and Sunday were supplied. Capitol Hill Block Party runs Friday–Sunday; Friday would
be **2026-08-07**. The feeds currently published from this data are a two-day festival. If Friday
exists, subscribers who add now will silently never see Friday sets — the feed will update when
the YAML does, so this is recoverable, but it should be resolved before the URL is shared.
**Action: send the Friday schedule image.**

### 2. Six sets have no printed end time (`CLOSE`)
Per the brief's rule, each was resolved to **start + 60 minutes** and marked `end_inferred: true`.
Every one of these is a guess and several are probably wrong — a main-stage headliner slot is
usually longer than an hour, and a club afters is usually much longer.

| Stage | Artist | Printed | Assumed end |
|---|---|---|---|
| Main (Sat) | DISCO LINES | 10:40–CLOSE | 23:40 Sat |
| Neumos (Sat) | AFTERS: NICKCHEO | 11:15–CLOSE | 00:15 **Sun** |
| Barboza (Sat) | AFTERS: DJ_DAVE + MGNA CRRRTA | 11:00–CLOSE | 00:00 **Sun** |
| Main (Sun) | WET LEG | 8:40–CLOSE | 21:40 Sun |
| Daydream (Sun) | MPH | 9:00–CLOSE | 22:00 Sun |
| Neumos (Sun) | AFTERS: DJ100PROOF + THE LAST SKEPTIK | 10:00–CLOSE | 23:00 Sun |

The two marked **Sun** cross midnight and were resolved to the following calendar date — that is
the post-midnight rule from the brief applied to an inferred end rather than a printed start.

**Action: supply real curfew times, or accept 60 minutes.** My recommendation is to find the
outdoor curfew (one number covers both main-stage cases) and treat club afters as ending at 02:00.

### 3. Artist casing cannot be derived from this source
The poster is set entirely in uppercase, so it carries **no information about official
stylization**. Rather than invent casing, every `artist` value preserves the poster string exactly
as printed, with the poster string also stored in `raw`.

This is the single largest cosmetic issue in the data. Several of these acts almost certainly
style themselves in mixed or lower case — `john-robert` and `nickcheo` are likely lowercase,
`Wet Leg`, `Tinashe`, `Amber Mark`, `Mallrat`, `Parcels`, `Zack Fox`, `Momma`, `Night Tapes`,
`Rochelle Jordan`, `Avalon Emerson & The Charm`, `Scott Yoder` are likely title case — but
"almost certainly" is not good enough to write into a published feed, and correcting them from
memory is exactly the silent guessing the brief prohibits.

Good news on the risk: **UID normalization lowercases before hashing**, so fixing casing later
changes only display text and does not orphan a single subscriber's event. This is safe to defer.

**Action: correct against the official lineup page, then re-run the build.**

### 4. Combined "AFTERS" billings kept as one event
Three slots bill two acts on one line (`DJ_DAVE + MGNA CRRRTA`, `DJ100PROOF + THE LAST SKEPTIK`).
Each is transcribed as **one event** with the combined billing as the artist string, because the
poster presents one continuous time block, not two slots. Splitting them would invent start times
that are not printed anywhere.

The `AFTERS` label and the `(DJ SETS)` annotation are recorded in `notes`, not folded into the
artist name — they are programming metadata, not part of anyone's name.

### 5. `MGNA CRRRTA` and `NICKCHEO` each play twice
Both appear on two different stages on Saturday. This is correctly two separate events with
different UIDs, because stage id is part of the UID. **It would have been a silent collision had
either played the same stage twice** — the brief's UID formula has no set-index component. The
build now hard-fails on duplicate UIDs rather than letting one event overwrite the other.

### 6. Low-confidence reads — none
Every artist name and time was legible at 2×. No character was guessed. `MGNA CRRRTA`
(three R's), `KENSHI KILLZZZ` (three Z's), `DSRT FLWR`, and `DJ100PROOF` were each re-checked
specifically because they look like OCR errors and are not.

### 7. Stage identity
Four stages: `main`, `daydream`, `neumos`, `barboza`. Neumos and Barboza are Seattle venues, so
those names are stable. Display names are as printed (`MAIN STAGE` → "Main Stage" etc.). Per the
URL contract, these four ids are **permanent from first publish** and must never be renamed.

### 8. Official URL not verified
`https://www.capitolhillblockparty.com/` is taken from the poster footer
(`CAPITOLHILLBLOCKPARTY.COM`). The specific schedule page path was not supplied and has not been
fetched. **Action: confirm the deep link to the schedule page.**
