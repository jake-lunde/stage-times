# Stage art explorer

Default state (owner pick, 21 Sep 2026): Beads, no core, Light ground (the stage color mixed
45% toward cream behind the art only; the card body stays the stage color), no glow, drift,
no scrim, ambient names in the Poster block treatment in ink, stars on the closers lit in the stage color.

A knob-turning tool for the generative stage-card art (ticket 06 follow-on, 20 Sep 2026).
Open `index.html` in a browser. It is a design instrument, not a page of the site: it loads
Archivo and Fragment Mono from Google Fonts, which the site's own pages never do.

- `template.html` is the source; `chbp-2026.json` is the data snapshot it embeds at `__DATA__`.
- Every family is seeded by `festival-key/stage-id` through the same FNV-1a and mulberry32 as
  `src/pages.ts`, integer coordinates throughout, so a chosen configuration ports to the build
  unchanged and stays byte-reproducible.
- Owner ruling recorded in the design skill: the art slot is exempt from the flat rule. Glow
  (radial falloff plus a bloom blur) and the scrim are allowed there and nowhere else.
- Rays: one core per stage at half the art height, rays leaving its edge on a clock: 2 PM at
  twelve, a set's start is its ray's position, its length is the width. Cores: Polar (a bump
  on the rim per set, aligned with its ray), Eclipse (a full disc for an afternoon stage, a
  crescent the later it runs), Bars (the seven longest sets as capsules), and the seeded-only
  Blob, Facets (the festival's globe), Cluster, and Soft (no edge). Regular polygons were
  tried and dropped: they read as signage.
- Rays do not read as a count: sets at the same hour on different days stack into one ray.
  Ray mapping offers Fanned by day (each day nudged a few degrees) and Even (running order, no
  clock). Five countable families sit beside Rays, one mark per set that never merges: Petals
  (capsules in running order), Beads (a ring per day, evenly spaced from the core to the card edge, a bead per set at its
  clock position; bead size is set length, the ring is solid across the hours that day runs,
  each ring drifts at its own speed, stars mark the closers or every hour-plus set),
  Ticks (a bezel), Stars (time left to right, day top to bottom, the closer a sparkle), Crowd
  (scattered pills). All share the cores, names, scrim, and glow.
- The scrim sits between the marks and the core, so the core stays cream.
- "Compare cores" renders every core as a row; "Compare families" every countable family. The whole configuration lives in the URL hash,
  so a dialed-in look is a shareable link.
- Names: plain, 32px pills in deep / cream / ink, a ticker that runs the headliners along
  the bottom edge, or Ambient, which shows each headliner at the center of the art for about four seconds in
  turn, in one of six treatments (Marquee, Poster block, Crop, Ghost day, Stamp, Pill) while
  its star grows, or takes the pill's ink for Pill; the pill is drawn above the core, and
  on Beads the sparkles counter-rotate to stay upright (families without stars
  cycle the names at the bottom instead). Nothing is dimmed for a guessed end any more. Scrim is a separate
  toggle with a slider: a flat ink overlay on the art area only, under the names. Name ink
  (cream, deep, ink) colors the text treatments and the star while its name is up.

Regenerate `index.html` after editing the template:

```
node -e "const fs=require('fs');fs.writeFileSync('index.html',fs.readFileSync('template.html','utf8').replace('__DATA__',fs.readFileSync('chbp-2026.json','utf8')))"
```
