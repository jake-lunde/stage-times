# Transcription log — Capitol Hill Block Party 2026

Source images: `_ref/set-screenshots/CHBP+Daily+Schedule_FRIDAY.webp`, `…_SATURDAY.webp`,
`…_SUNDAY.webp` (1000×1333 each). Every column was cropped and re-read at 2× before
transcription; nothing below is a single-pass read. Friday was supplied and transcribed
2026-08-08, after the first pass; the Saturday/Sunday data was re-checked against the new
cleaner images at the same time and matched exactly.

Verified independently: **2026-08-07 is a Friday**, **2026-08-08 is a Saturday** and
**2026-08-09 is a Sunday**, matching the poster headers. Seattle is **PDT (UTC−7)** across the
whole festival — no DST transition falls inside the window, so gate 5's DST case is exercised by
a separate fixture, not by this data.

---

## Verbatim transcription

Times are exactly as printed. `CLOSE` is reproduced literally — it is not a time.

### FRIDAY AUGUST 7, 2026

**MAIN STAGE**
```
AVERY COCHRANE       3:15-3:45PM
ALIYAH'S INTERLUDE   4:15-4:45PM
NIMINO               5:15-6:00PM
BETWEEN FRIENDS      6:30-7:15PM
DJ TRIXIE MATTEL     7:30-8:30PM
MAGDALENA BAY        9:00-10:00PM
MUNA                 10:40-CLOSE
```

**DAYDREAM STAGE**
```
GIRL PARALLEL        2:35-3:05PM
ZAILEE HAZE          3:35-4:05PM
OTHA                 4:35-5:20PM
GELLI HAHA           5:50-6:35PM
AFTER                7:05-7:50PM
NINAJIRACHI          8:20-9:20PM
FROST CHILDREN       10:00-11:00PM
```

**NEUMOS STAGE**
```
CAMILLE CANO         5:45-6:30PM
FLEETWOOD SNACK      7:00-7:45PM
LOVELY COLOURS       8:15-9:00PM
CASI                 9:30-10:15PM
DARK CHISME          10:45-11:30PM
AFTERS: FROST CHILDREN (DJ SET) + DJ THANK YOU   11:30-CLOSE
```

**BARBOZA STAGE**
```
GIVE ME THE MONEY    5:15-6:00PM
EMI POP              6:30-7:15PM
CLOVER               7:45-8:30PM
DREW MARTIN          9:00-9:45PM
GLASS EGG            10:15-11:00PM
AFTERS: DOUBLE SUNRISE CLUB   11:30-CLOSE
```

Friday quirks, all checked at 2×: the Daydream act **AFTER** is a band name in an ordinary
7:05 PM slot, not an afters billing — the poster's afters blocks are labelled `AFTERS` in italic
and sit at the bottom of the column. **FROST CHILDREN** plays twice (Daydream live set, then the
Neumos afters as a DJ set) — two stages, so two UIDs, same as NICKCHEO on Saturday.
**LOVELY COLOURS** is the British spelling as printed.

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

**Totals:** 26 Friday (7 main + 7 daydream + 6 neumos + 6 barboza) + 29 Saturday
(7 main + 7 daydream + 7 neumos + 8 barboza) + 24 Sunday (6 per stage) = **79 sets** across
4 stages. This matches the count the build reports; if the two ever diverge, the build is right
and this document is stale.

---

## Ambiguities — every one of these needs a human decision before publish

### 1. Friday is missing — RESOLVED 2026-08-08
The Friday schedule image was supplied (`CHBP+Daily+Schedule_FRIDAY.webp`) and its 26 sets are
transcribed above and in the YAML. The feed now covers all three days.

### 2. Nine sets have no printed end time (`CLOSE`) — fallback accepted 2026-08-08
Each is resolved to **start + 60 minutes** and marked `end_inferred: true`, which puts a caveat
in the subscriber-visible event description saying the end time is assumed.

Real end times were searched for on 2026-08-08 and **could not be determined**: the official FAQ
(capitolhillblockparty.com/faq) lists gate-opening times only, the official schedule page prints
the same posters, and press coverage (EverOut, CHS, Dance Music NW, Music Festival Wizard) states
no closing times. The owner's rule for this case: fall back to 60 minutes and say so in the
event. If a real curfew ever surfaces, update the ends in the YAML and the feed will push the
correction to subscribers.

| Stage | Artist | Printed | Assumed end |
|---|---|---|---|
| Main (Fri) | MUNA | 10:40–CLOSE | 23:40 Fri |
| Neumos (Fri) | AFTERS: FROST CHILDREN (DJ SET) + DJ THANK YOU | 11:30–CLOSE | 00:30 **Sat** |
| Barboza (Fri) | AFTERS: DOUBLE SUNRISE CLUB | 11:30–CLOSE | 00:30 **Sat** |
| Main (Sat) | DISCO LINES | 10:40–CLOSE | 23:40 Sat |
| Neumos (Sat) | AFTERS: NICKCHEO | 11:15–CLOSE | 00:15 **Sun** |
| Barboza (Sat) | AFTERS: DJ_DAVE + MGNA CRRRTA | 11:00–CLOSE | 00:00 **Sun** |
| Main (Sun) | WET LEG | 8:40–CLOSE | 21:40 Sun |
| Daydream (Sun) | MPH | 9:00–CLOSE | 22:00 Sun |
| Neumos (Sun) | AFTERS: DJ100PROOF + THE LAST SKEPTIK | 10:00–CLOSE | 23:00 Sun |

The rows marked with a following day cross midnight and were resolved to the next calendar
date — the post-midnight rule from the brief applied to an inferred end rather than a printed
start.

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

### 5. `MGNA CRRRTA`, `NICKCHEO` and `FROST CHILDREN` each play twice
The first two appear on two different stages on Saturday; Frost Children plays the Daydream
stage and then the Neumos afters on Friday. Each case is correctly two separate events with
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
