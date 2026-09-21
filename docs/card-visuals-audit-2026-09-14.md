# Card visuals audit — ticket 06

**Date:** 14 September 2026
**For:** the homepage edition cards (ticket 06: the homepage lists listed editions) and, by
extension, the stage cards on the subscribe page, which share the same anatomy.
**Direction:** Apple Store / Cash App. Big, minimal, every string readable by a human.

This is an inventory of what the build can put on a card *today* with zero new inputs, what it
could put there with a small data or build change, and what it cannot or should not. Verdicts are
mine; owner calls are marked.

The one-line finding: **there is no artist imagery worth chasing, and festival imagery is
curated, not programmatic. The data itself is the visual.** The four things that make these cards
alive are the stage colors, type, the real schedule drawn as capsules, and a share preview that
does not exist yet.

---

## 1. What the build already exposes

Everything below is in `dist/feeds.json` (the manifest) or one step from it. No clock, no
network, byte-stable.

| Datum | Example (CHBP 2026) | Notes |
|---|---|---|
| Festival name, year | Capitol Hill Block Party, 2026 | Name may change freely; slug is frozen |
| Day span | `Fri 7 Aug – Sun 9 Aug 2026`, 3 days | Label is long for an eyebrow; a short form (`AUG 7–9`) is a formatter change, not a data change |
| Set count | 79 total; 20 / 20 / 19 / 20 per stage | 78 unique artists (Frost Children play twice, on different stages) |
| Stage count, names, descriptions | 4; "Indoor basement at Barboza. Short sets, quick turnarounds." | Description is optional in the schema |
| Per-stage color | red, blue, green, magenta… | Assigned by YAML order and frozen. Eight colors, all cleared for cream text |
| Headliners | Main: MUNA, DISCO LINES, WET LEG | "Closer per calendar day, in day order" — see §4 for why this misfires on late stages |
| First set, last set, last end | Barboza: 17:15 → 21:30 → 22:00 | Enables "3 PM to late" and the time-of-day art below |
| Every set's start, end, `end_inferred` | 79 rows | Enables the schedule strip (§3) |
| Time zone label | Pacific | `zoneLabel()` |
| `verified`, `listed`, `blocked`, `namespace` | true, true, false, owner | Homepage cards only ever see verified + listed editions. Fan editions can be listed |
| Last-updated stamp | 8 August 2026 | Footer material, not card material |
| Committed festival image | `assets/festivals/capitol-hill-block-party-2026.webp`, 1500×843 | The festival's own art. One exists |
| Procedural capsule art | seeded SVG per festival key / stage id | Decorative; no meaning |
| Fonts | Archivo variable (wdth 62–125), Fragment Mono | Self-hosted woff2 |
| Icons | back, link, check | Inline SVG |

## 2. What does not exist

| Missing | Where it shows | Verdict |
|---|---|---|
| **City / location** | Eyebrow (`AUG 7–9 · SEATTLE`, as drawn in `references/screens.md`) | Add `city:` to festival meta. Display-only, so not frozen. Ingest can read it off the poster (`SEA WA`) or the owner types it |
| **Favicon, apple-touch-icon, web manifest, `theme-color`** | Browser tab, Safari bookmarks, iOS share sheet | None on either page. Static assets, commit once. Not programmatic, but nothing else lands until they exist |
| **OG / Twitter card image** | iMessage, Slack, Instagram DM previews when someone texts the link | None. **This is the highest-leverage visual that doesn't exist** — the link gets shared by text, and the preview is the first card anyone sees. Programmatic per edition; see §5 |
| **Festival logo as vector** | Card, OG image | Only the raster hero. Owner-curated if ever |
| **Artist imagery** | Card art | None anywhere, posters included. See §6 for why it stays that way |
| **Past/upcoming state** | Homepage ordering, a "this weekend" chip | The build never reads the clock (README contract). Order by date is possible from data; "past" is not. Client JS could, at the cost of the no-clock purity on the page. Owner call; my read is skip it — an attendee visits once, during the festival |

## 3. Visuals the build can draw from the data

Ranked by how much they earn for the card. All deterministic, all inline SVG or CSS, no new
dependencies unless noted.

1. **The schedule strip.** Every set drawn as a capsule bar: x is time of day (2 PM to 2 AM),
   width is duration, one row per festival day. Per stage on the stage cards; all four stages
   laned per row on the festival card. This is the procedural capsule art with the randomness
   replaced by the truth. A Barboza card reads "short sets, quick turnarounds" before you read
   the words, and a Neumos card visibly runs late. It is also the CHBP poster's own visual
   language (rounded blocks on a time grid), so it looks native to the source. Inferred ends
   can render at reduced opacity, which is the honest thing. Generated from the same rows the
   feeds come from, so it never lies. **Recommend: replaces the random capsules.**
2. **Big number.** `79` at display size, `sets` beneath it in mono. The single most Cash App
   gesture available (the keypad `$0`). Works on the festival card as the art-area fallback when
   there is no image and no strip. Also the natural OG-image composition.
3. **Stage color row.** One capsule per stage, in the frozen stage color, on the festival card.
   Ties the homepage card to the carousel you land on. Four small pills is honest information
   (four stages) and a color signature at once.
4. **Day chips.** `FRI SAT SUN` as capsule chips, filled for the days a stage runs. Only earns its
   place on a stage that skips a day; on CHBP every stage runs all three, so it would be noise.
   Keep in the toolbox for multi-weekend festivals.
5. **Headliner type.** Already the art on the stage cards, and it should stay the artist visual
   (§6). At 3 lines × 18px semibold it is doing the job. The strings need the fixes in §4.
6. **Poster-derived stage colors.** The CHBP poster colors its stages (teal, magenta, powder
   blue, olive). Ingest could sample them; a `color:` per stage is display text, not contract.
   But `references/color.md` says assign by order and freeze, and the poster colors are pastels
   that fail cream text. **Owner call; my read is no.** Ours are better and consistent across
   festivals.
7. **Image palette extraction.** The build could sample the committed hero's dominant colors to
   tint the card's eyebrow or pill. Deterministic (committed bytes in, same numbers out), but it
   needs an image decoder (`sharp`) and the repo has zero image dependencies today. Modest gain.
   Skip until an OG generator brings a rasterizer in anyway.

## 4. The headliner strings need two fixes before they can carry a card

The derivation is "last-starting set per calendar day per stage". Two things fall out of it:

- **Late stages headline their afters.** Neumos: `FROST CHILDREN (DJ SET) + DJ THANK YOU`,
  `NICKCHEO`, `DJ100PROOF + THE LAST SKEPTIK`. Barboza: `DJ_DAVE + MGNA CRRRTA`. Those are the
  closers by the glossary's definition, but they are not who anyone would call the headliner,
  and at 39 characters they wrap. The glossary already says a headliner is "a display
  convenience, not a schedule fact", so an optional `headliners:` list per stage (and one per
  festival, for the homepage card) in the YAML is legitimate and frozen-safe. Ingest can propose
  it; the uploader confirms it on review like any other set.
- **Poster caps.** Every artist is uppercase because the poster is. At eyebrow or lineup size
  caps read fine and look like the poster; at heading size they shout. The R6 title-case ruling
  (copy review, 6 Sep) is still open and is a data change. Until it lands, cards render artists
  as the data has them, which means the design must be built for caps at ≤18px and must not
  put an artist in a 30px heading.

For the homepage card, take the headliners from the first stage in YAML order (the main stage
by convention), not per-stage closers merged. Three names, day order, one line separated by
middle dots, or three stacked lines when the art area carries them.

## 5. The share preview (OG image)

1200×630, one per edition, generated at build: festival name in expanded Archivo, the date
eyebrow, `79 sets · 4 stages`, on the stage-1 color or the red flood, with the schedule strip
or the stage color row as the only ornament. Also a site-level one for `/`.

Cost: a rasterizer. `@resvg/resvg-js` (WASM, deterministic PNG for identical SVG input, no
native build) keeps the build reproducible; `sharp` would too but pulls a native binary. The
fonts are already in the repo. The golden-file test extends to the PNG bytes.

Why it outranks everything else in this doc: the product spreads by one friend texting another
the link. iMessage shows the OG image at roughly the size of the homepage card. That preview is
the card most people see, and today it is blank.

## 6. Artist imagery: audited and declined

Constraints that any source has to clear: pages make no third-party requests (`README`,
`SKILL.md`), nothing is hotlinked, the design system forbids photos in the art area, this repo
is public so a committed image is permanent (ADR-0003, and the takedown runbook requires
deletion), and the design has to overlay type on the art.

| Source | Auth | Coverage for a CHBP-type lineup | Terms | Verdict |
|---|---|---|---|---|
| Spotify Web API | client credentials | high for signed acts, patchy for the 60-odd local ones | no storing beyond the session, no cropping or overlays, must link back to Spotify | **No** — fails self-hosting and the overlay |
| Apple Music API | developer token, paid program | similar | attribution and link-back | **No** |
| Deezer public API | none | decent | images are rights-holder property, reproduction forbidden | **No** |
| Bandsintown public API | app id | good for touring acts | could not verify from this sandbox (egress blocked) | Unverified; press shots, still a photo |
| MusicBrainz → Wikidata P18 → Wikimedia Commons | none | low; maybe 1 in 6 of 78 mostly local artists | CC / public domain, committable with attribution | Legal, but a card system that works for one artist in six is not a system |
| Scrape the festival's lineup page | none | complete | rights-holder content; permanence in a public repo | **No** — the same problem ADR-0003 leaves open for source images |

Conclusion: names are the artist visual. That is what the festival's own poster does, it is
what the design skill's headliner-preview rule already says, and it is the only version that
works for every edition including fan uploads with no assets at all.

## 7. Festival imagery: curated, not programmatic

- One committed hero exists. Every future edition arrives by upload, and the only image an
  upload guarantees is the source poster, which is the schedule itself and has to live in the
  private store, not the repo. So **the card system must look finished with no image**; the
  hero is the exception the owner adds by hand for editions he lists.
- The CHBP hero is off-palette (charcoal, olive, teal against cream and vermillion). It reads as
  a poster pinned to the wall, which is defensible, but it is the only element on the site
  outside the four-color system. Two ways to contain it: crop it to the art area and never let
  it touch the card's type, or reserve real imagery for the OG image and keep the on-page card
  procedural. Owner call.
- The image's dimensions are hardcoded (`aspect-ratio:1500/843`). Reading them at build is
  cheap once a decoder exists; until then, one aspect for all heroes is a rule, not a bug.

## 8. Card block-out

The five slots Jake named, mapped to both card types. Same anatomy, one component, two data
sources.

| Slot | Homepage edition card | Subscribe stage card | Source | Rule |
|---|---|---|---|---|
| **Art** | hero image if committed, else schedule strip (all stages laned), else big number | schedule strip for that stage, in the stage color | `assets/festivals/`, `sets[]` | Edge to edge, 24px radius, no padding. Never a photo of a person |
| **Eyebrow** | `AUG 7–9, 2026 · SEATTLE` | (none — the stage name carries) | `dayspan` + new `city` | Mono, 12px, caps, tracked. Year lives here so the heading stays the name |
| **Heading** | `Capitol Hill Block Party` | `Main Stage` | `festival.name` / `stage.name` | 30–34px, 600, expanded. Shrinks for long names, never wraps past two lines |
| **Headliners** | `MUNA · DISCO LINES · WET LEG` | same, per stage | `headliners` (with the override from §4) | ≤3, day order, ≤18px semibold, caps as the data has them |
| **Subtitle** | `79 sets · 4 stages · 3 days` | `20 sets · Fri–Sun` + the description line | manifest counts, `stage.description` | Mono caps for the numbers; the description is the one sentence of prose |
| **CTA** | `See stages` pill, whole card tappable | `Add calendar` pill + 44px copy icon button | | Pill holds words only; the card shrinks on press |

Optional slot, homepage only: a `Fan-made` chip on listed fan editions. Copy question, not a
visual one, but the card needs the slot reserved.

States the component has to survive: one edition (today) or ten; a one-day festival (the span
collapses to one date); twelve stages (the color row wraps or truncates to a count); no
description; no image; a 40-character festival name; dark mode (the tokens handle it, the hero
image does not invert and should not).

## 9. Recommended order of work

1. Add `city` and optional `headliners` to the schema and the CHBP YAML. Display-only, frozen-safe.
2. Short date formatter for the eyebrow (`AUG 7–9, 2026`).
3. Schedule strip replaces the random capsules on the stage cards; the festival card gets the laned version as its no-image fallback.
4. Static favicon set: SVG monogram, 180px apple-touch-icon, `theme-color` per page.
5. OG image per edition, with `@resvg/resvg-js`, golden-tested.

1–3 are ticket-06 work. 4 and 5 are their own tickets; 5 is the one I would fight for.

---

## Addendum, 20 September 2026: generative stage art

Owner ruling: the flat rule is lifted for the art area of a card, and only there. Recorded in
the design skill (non-negotiable 3 and `references/color.md` rule 4).

Explorer, with the real CHBP sets driving it: https://claude.ai/artifact/APEDRrJAfPHrbU9LSLqqmY

Five families, all seeded by `festival-key/stage-id` through the build's FNV-1a and mulberry32,
all integer-coordinate SVG:

| Family | What drives it | Flat? |
|---|---|---|
| Rays | one wedge per set; angle = start time, width = length; source height = how late the stage runs | yes; Glow adds a radial falloff and bloom |
| Ridgeline | one line per day; each set a hump, position = start, height = length, guessed ends softer | yes |
| Rings | one ring per set from the center out, stroke weight = length | yes |
| Noise field | seeded value noise, amplitude from set count; texture only | yes |
| Capsules | the shipping art, unchanged | yes |

Grounds: stage color, deep (stage color cut toward black — the neon ground without leaving the
palette), paper. Halftone renders the rays as dot-screen wedges, the screenprint version of a
glow, for anyone who wants the read without the gradient.

Costs to measure before shipping Glow: the bloom is an SVG blur filter, cheap for four cards,
worth pre-rendering at build for a carousel of twelve. Cream headliner text over a lit wedge
drops under 4.5:1 near the source, so the source sits high and the names sit low, or the names
get a flat tab.

---

## Addendum, 21 September 2026: the beads ship

Owner pick after dialing the explorer: **Beads**, no core, on a light ground (the stage color
mixed 45% toward cream behind the art only), no glow, no scrim, drift on, ambient headliner
names as a **poster block** (night and start time above the name) in ink, each night's closer a
star that lights in the stage color while its name is up. Ported to `beadsArt()` in
`src/pages.ts`; the manifest now carries every set's start and end per stage for it. Spec in
the design skill under Card art. 235 tests pass; the CHBP feeds are unchanged.

Two things the owner flagged for next:

- **Stage colors from the posters.** Revisit §3.6: the explorer has a Poster colors toggle with
  the four CHBP poster hues sampled (teal, magenta, powder blue, olive) so the two palettes can
  be compared on the live art. Any change means a `color:` per stage in the YAML and a ruling
  on `references/color.md`'s assign-by-order rule.
- **The stage subtitle.** The explorer's debug line ("late 75%") is gone; it now proposes
  `2:45 PM to 2:15 AM · 45-minute sets` under the set count, with the YAML description below.
  The build still prints `20 sets · Fri – Sun` plus the description until the owner picks the
  line.

Open from before, now load-bearing: the headliner override (§4). The card headlines each
night's closer, so Neumos and Barboza show the afters DJ combos and the 39-character names
shrink to fit. The card also assigns a post-midnight set to the night it belongs to, so
Saturday's Main Stage headliner reads Instant Crush (1:45 AM) where the glossary's calendar-day
rule would say Disco Lines. That is a glossary question for the owner.
