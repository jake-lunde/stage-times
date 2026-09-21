# Stage art explorer

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
- "Compare cores" renders every core as a row. The whole configuration lives in the URL hash,
  so a dialed-in look is a shareable link.
- Names: plain, 32px pills in deep / cream / ink, or a ticker that runs the headliners along
  the bottom edge (speed from their length, static under reduced motion). Scrim is a separate
  toggle: a flat 15% ink overlay on the art area only, under the names.

Regenerate `index.html` after editing the template:

```
node -e "const fs=require('fs');fs.writeFileSync('index.html',fs.readFileSync('template.html','utf8').replace('__DATA__',fs.readFileSync('chbp-2026.json','utf8')))"
```
