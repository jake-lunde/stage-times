# Transcription log — Ohana Festival 2026

Machine transcription, checked set by set against the source image by a human.

Source images: `2ff9fea64d889d2a021c554083d058c1d34ac3c647438de9ad4a1ab874a758b3.jpg`, `e49cbb1384c6269c3b69a5ee0133f179031b474a7e5c0de8ee76ab3609619520.jpg`, `976af6f686f09314a6bd1abb472ffc2a5af419bff4b9c40f7af59aa76d200bde.jpg`.

---

## Verbatim transcription

Times are exactly as printed. `CLOSE` is reproduced literally — it is not a time.

### FRIDAY, SEPTEMBER 25

**OHANA STAGE**
```
MUTTLEE                  1:00 – 1:30
FLORENCE ROAD            2:00 – 2:30  ASL interpreted performance
SUGAR                    3:05 – 3:45  ASL interpreted performance
BAD RELIGION             4:40 – 5:25  ASL interpreted performance
MANÁ                     6:45 – 8:00  ASL interpreted performance
EDDIE VEDDER & FRIENDS   8:40  ASL interpreted performance
```

**TIKI STAGE**
```
MEREBA                12:30 – 1:00
MIDNIGHT GENERATION   1:30 – 2:00
OTOBOKE BEAVER        2:30 – 3:00
COURTNEY BARNETT      3:50 – 4:30
BILLY IDOL            5:35 – 6:30  ASL interpreted performance
```

### SATURDAY, SEPTEMBER 26

**OHANA STAGE**
```
ELLERY HARPER       1:00 – 1:30  ASL interpreted performance
MARLON FUNAKI       2:05 – 2:40  ASL interpreted performance
THE FRONT BOTTOMS   3:25 – 4:05  ASL interpreted performance
MEN I TRUST         5:00 – 5:45  ASL interpreted performance
ALABAMA SHAKES      7:05 – 8:05  ASL interpreted performance
TYLER CHILDERS      8:45  ASL interpreted performance
```

**TIKI STAGE**
```
JAKE WESLEY ROGERS   12:30 – 1:00
P.E.S.T.             1:30 – 2:05
ALICE PHOEBE LOU     2:45 – 3:20
STEPHEN WILSON JR.   4:10 – 4:50
JON BATISTE          5:55 – 6:50
```

### SUNDAY, SEPTEMBER 27

**OHANA STAGE**
```
VILLANELLE       1:00 – 1:30  ASL Interpreted Performance
LINKA MOJA       2:00 – 2:30  ASL Interpreted Performance
ECCA VANDAL      3:05 – 3:35  ASL Interpreted Performance
RILO KILEY       4:30 – 5:15  ASL Interpreted Performance
FONTAINES D.C.   6:30 – 7:30  ASL Interpreted Performance
PEARL JAM        8:10  ASL Interpreted Performance
```

**TIKI STAGE**
```
SPEED OF LIGHT   12:30 – 1:00
HORSEGIRL        1:30 – 2:00
TOM ODELL        2:30 – 3:00
THE FORMAT       3:40 – 4:20
PIXIES           5:25 – 6:15
```

**Totals:** 11 on 2026-09-25 + 11 on 2026-09-26 + 11 on 2026-09-27 = **33 sets**.

---

## Corrections made on review

None — every set is exactly as the machine read it.

---

## Ambiguities — every one of these needs a human decision before publish

### 1. 3 sets have no printed end time (`CLOSE`, or a start alone)

Each is a guess: **start + 90 minutes** for the last set printed on its stage that day
(the closer), **start + 60 minutes** for any other, marked `end_inferred: true`; the
subscriber-visible event description says the end is a guess and by how much. If a real
curfew or club close time surfaces, correct the ends in the YAML and rebuild.

| Stage | Artist | Printed | Assumed end |
|---|---|---|---|
| ohana | EDDIE VEDDER & FRIENDS | 8:40 | 22:10 |
| ohana | TYLER CHILDERS | 8:45 | 22:15 |
| ohana | PEARL JAM | 8:10 | 21:40 |

### 2. Artist casing cannot be derived from this source

Poster casing is preserved exactly as printed (typically all-uppercase), because
the poster carries no information about official stylization. Correct casing
against the official lineup page if wanted — UID normalization lowercases before
hashing, so casing fixes are display-only and orphan no subscriber events.

### 3. Official URL not verified

`https://ohanafest.com/schedule` is derived from the poster footer (normalized to a
lowercase https URL). The link has not been fetched — confirm before publish.

### 4. 1 line the model was unsure of

Check each against the poster. These are the review screen's flags.

| Stage | Artist | Printed | Why |
|---|---|---|---|
| ohana | TYLER CHILDERS | 8:45 | Only a single start time (8:45) is printed for this set; no end time is shown on the poster. |

### 5. Transcriber observations (verbatim from the vision model)

- Poster logo reads 'OHANA' with a small '10 YEARS' subtitle beneath it, indicating a 10th-anniversary edition; used 'OHANA' as the festival_name since that's the primary printed wordmark.
- The day header prints 'FRIDAY, SEPTEMBER 25' with no year shown; September 25 falls on a Friday in 2026 (not 2025, which is a Thursday), so the ISO date was set to 2026-09-25 to match the printed weekday.
- A hand-icon glyph appears next to several sets on the poster with a legend at the bottom of the Ohana Stage column reading '= ASL INTERPRETED PERFORMANCE'; this was applied as an annotation to every set marked with that icon (Florence Road, Sugar, Bad Religion, Maná, Eddie Vedder & Friends, and Billy Idol).
- Eddie Vedder & Friends is printed with only a start time (8:40) and no end time or 'CLOSE' label, so only '8:40' was recorded as the time.
- No official festival URL is printed anywhere on this poster image.
- Poster logo reads 'OHANA' with a '10 YEARS' subtitle beneath it, indicating this is the 10th anniversary edition of the festival; used 'OHANA' as the festival_name per the primary logo text.
- The printed weekday 'SATURDAY' for September 26 only aligns with the calendar in the year 2026 (Sept 26, 2025 would be a Friday), so 2026 was inferred for the ISO date field.
- A hand icon with 'ASL' styling appears next to several Ohana Stage sets; interpreted as the printed legend states: '= ASL INTERPRETED PERFORMANCE'. This icon does not appear next to any Tiki Stage sets.
- Doors time (12PM) is printed under the day header but is not a performance set, so it was not included as a stage entry.
- Tyler Childers' entry only shows a single start time (8:45) with no end time printed, unlike all other sets which show a time range.
- Poster header reads 'SUNDAY, SEPTEMBER 27' with no year printed; the year 2026 was inferred because September 27 falls on a Sunday that year.
- A hand icon labeled 'ASL INTERPRETED PERFORMANCE' appears next to every set on the Ohana Stage; this was captured as an annotation on those sets. No such icon appears on the Tiki Stage sets.
- Pearl Jam's set only shows a start time (8:10) with no end time printed on the poster.
- The festival logo displays 'OHANA' with a smaller '10 YEARS' subtitle beneath it, indicating this may be a 10th-anniversary edition.
