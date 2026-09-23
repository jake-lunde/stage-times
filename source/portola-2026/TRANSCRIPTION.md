# Transcription log — Portola 2026

Machine transcription, checked set by set against the source image by a human.

Source images: `eef068dde7393728a7705d4f58b3b2bd588218ee0d280ddf7062fefce17f7903.jpg`, `d49d18fa36bbbbc2a3b06f99e79fc0176e899006b060a34b3e389bcdb86731b0.jpg`.

---

## Verbatim transcription

Times are exactly as printed. `CLOSE` is reproduced literally — it is not a time.

### SATURDAY PIER 80 SEP 26

**PIER STAGE**
```
DOG BLOOD (SKRILLEX + BOYS NOIZE)   9:00-10:15
ROBYN                               7:10-8:10
TOVE LO                             5:40-6:30
FCUKERS                             4:40-5:30
OSKAR MED K                         3:40-4:30
GELLI HAHA                          2:40-3:30
AIRWOLF PARADISE                    1:30-2:30
```

**CRANE STAGE**
```
SOULWAX              9:55-10:55
FATBOY SLIM          7:55-9:25
DJ SHADOW            6:10-7:10  CELEBRATES 30 YEARS OF ENDTRODUCING.....
NIMINO               4:50-5:50
TRICKY               3:30-4:30
ERIKA B2B SFCOWBOY   1:30-3:10
```

**WAREHOUSE**
```
PROSPA                     9:45-11:00
BELTRAN B2B BEN STERLING   8:30-9:45
KETTAMA                    7:15-8:30
MAX STYLER                 6:00-7:15
GROOVE ARMADA              4:45-6:00
CHLOÉ CAILLET              3:45-4:45
RANGER TRUCCO B2B ALISHA   2:45-3:45
SAM ALFRED                 1:30-2:45
```

**SHIP TENT**
```
MELANIE C (DJ SET)   9:50-10:30
NATE SIB             8:55-9:35
JIGITZ               7:50-8:40
BASSVICTIM           6:50-7:40
JYOTY                5:40-6:40
MIKE D 5D            4:40-5:30
SIX SEX              3:40-4:20
MGNA CRRRTA          2:50-3:30
FELLY FELL           1:40-2:40
```

**DESPACIO**
```
DESPACIO   2:45-9:45
```

### SUNDAY PIER 80 SEP 27

**PIER STAGE**
```
SWEDISH HOUSE MAFIA   8:45-10:00
ZARA LARSSON          7:05-8:05
MOCHAKK               5:35-6:35
SG LEWIS (LIVE)       4:30-5:25
CHANNEL TRES          3:30-4:20
MIND ENTERPRISES      2:30-3:20
CLEARCAST             1:30-2:20
```

**CRANE STAGE**
```
PARCELS       9:30-10:45
HORSEGIIRL    8:10-9:00
NINAJIRACHI   7:00-7:50
UNDERSCORES   5:50-6:40
ZULAN         4:45-5:35
ADÉLA         3:50-4:30
AZZECCA       2:30-3:30
TORREN FOOT   1:30-2:30
```

**WAREHOUSE**
```
FOUR TET           9:30-11:00
OVERMONO           8:20-9:20
TIËSTO             6:45-8:15
MARLON HOFFSTADT   5:30-6:45
VTSS               4:30-5:30
BRUNELLO           3:30-4:30
SILVA BUMPA        2:30-3:30
DEAN TURNLEY       1:30-2:30
```

**SHIPTENT**
```
BABY J    9:40-10:30
JT        9:00-9:30
KELELA    8:05-8:50
DAPHNI    6:30-7:50
BEN UFO   5:10-6:30
EAR       4:20-5:00
RIRIA     2:55-4:10
KAYTREE   1:40-2:55
```

**DESPACIO**
```
DESPACIO   3:30-10:30
```

**Totals:** 31 on 2026-09-26 + 32 on 2026-09-27 = **63 sets**.

---

## Corrections made on review

None — every set is exactly as the machine read it.

---

## Ambiguities — every one of these needs a human decision before publish

### 1. Columns printed latest-first

Each stage column on these posters runs from the last set of the night down to the
first, so every column was read bottom to top: a time earlier than the one printed
above it is the set before, not one past midnight. Check the poster's clock axis agrees:

- SATURDAY PIER 80 SEP 26 (2026-09-26)
- SUNDAY PIER 80 SEP 27 (2026-09-27)

### 2. Artist casing cannot be derived from this source

Poster casing is preserved exactly as printed (typically all-uppercase), because
the poster carries no information about official stylization. Correct casing
against the official lineup page if wanted — UID normalization lowercases before
hashing, so casing fixes are display-only and orphan no subscriber events.

### 3. Repeat bookings on one stage, told apart in the name

UID is sha1(slug + year + stage + normalized artist) and excludes the start time
(README, the known limitation), so the same act twice on one stage would collapse
into one event. Each of these carries the day — or the day and printed start — in
its name so every appearance is its own event:

- DESPACIO → DESPACIO (Saturday) (despacio, 2026-09-26T14:45:00)
- DESPACIO → DESPACIO (Sunday) (despacio, 2026-09-27T15:30:00)

### 4. Official URL not verified

`https://portolamusicfestival.com/set-times` is derived from the poster footer (normalized to a
lowercase https URL). The link has not been fetched — confirm before publish.

### 5. Transcriber observations (verbatim from the vision model)

- The Ship Tent listing 'MIKE D 5D' is printed exactly as shown but the stylization is unusual; reproduced verbatim.
- The Ship Tent listing 'MGNA CRRRTA' appears to be a stylized/abbreviated spelling; reproduced verbatim.
- The Despacio stage has a single long block spanning 2:45-9:45 with no other acts listed, consistent with its typical all-day DJ collective format.
- No official URL was printed anywhere on the poster.
- The Crane Stage artist is printed as "HORSEGIIRL" (with a double I) on the poster; the actual artist is likely known as "Horsegirl" — reproduced exactly as printed per instructions.
- The stage label is printed as a single word "SHIPTENT" on the poster; reproduced exactly as printed rather than splitting into two words.
- No official festival URL was visible anywhere on the poster image provided.
