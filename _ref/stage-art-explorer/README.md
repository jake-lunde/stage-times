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
- Rays: one shape per stage at half the art height, assigned by stage order like the color.
  Clock mapping: 2 PM at twelve, a set's start is its ray's position, its length is the width.
- Names: plain, scrim, or 32px pills in deep / cream / ink.

Regenerate `index.html` after editing the template:

```
node -e "const fs=require('fs');fs.writeFileSync('index.html',fs.readFileSync('template.html','utf8').replace('__DATA__',fs.readFileSync('chbp-2026.json','utf8')))"
```
