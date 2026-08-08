# Stage Times — session handoff

**Date:** 8 August 2026
**Repo:** `/Users/jake/Documents/github/stage-times`
**Preview:** https://stage-times-kqx269xho-lunde-os.vercel.app
**Vercel project:** `stage-times` @ LUNDE OS (`prj_mbuC9M3JFa5BMrEajeneh0vtLeHJ`)

Status: **first pass complete and deployed to preview.** Nothing is in production, and the build
physically refuses to publish until a human verifies the set times.

---

## What exists now

```
.claude/skills/stage-times-design/   design system (SKILL.md + color.md + screens.md)
data/capitol-hill-block-party-2026.yaml   real lineup, verified: false
source/TRANSCRIPTION.md              transcription log + every ambiguity
src/ics.ts                           hand-rolled iCalendar serializer
src/schema.ts                        YAML types, validation, publish gate
src/build.ts                         deterministic build + state
src/pages.ts                         landing + subscribe page rendering
state/published.json                 frozen URL surface + publish stamp
state/sequences.json                 per-UID SEQUENCE ledger
tests/                               69 tests, all 8 validation gates
tests/fixtures/                      harbor-lights (edge cases), dst-check (DST gate)
vercel.json                          headers, output dir, test-gated build
```

**Tests: 69 passing.** Build output is byte-identical across runs (verified by diff). The deployed
feed is byte-identical to the local build.

---

## Three decisions waiting on you

### 1. Friday is missing — the biggest gap
You sent Saturday (8 Aug) and Sunday (9 Aug). Capitol Hill Block Party runs Friday too, which
would be **7 August 2026**. The feeds currently describe a two-day festival.

This is recoverable after publish — adding Friday later just updates subscribers' calendars — but
it's much better to fix before the URL is shared. **Send the Friday schedule image.**

### 2. Six sets have no end time
The poster prints `CLOSE` instead of a time. Per the brief I defaulted each to **start + 60
minutes** and flagged them, but several are certainly wrong — a closing headliner and a club
afters are both longer than an hour.

| Stage | Artist | Printed | Currently assumed |
|---|---|---|---|
| Main (Sat) | DISCO LINES | 10:40–CLOSE | ends 23:40 |
| Neumos (Sat) | AFTERS: NICKCHEO | 11:15–CLOSE | ends 00:15 Sun |
| Barboza (Sat) | AFTERS: DJ_DAVE + MGNA CRRRTA | 11:00–CLOSE | ends 00:00 Sun |
| Main (Sun) | WET LEG | 8:40–CLOSE | ends 21:40 |
| Daydream (Sun) | MPH | 9:00–CLOSE | ends 22:00 |
| Neumos (Sun) | AFTERS: DJ100PROOF + THE LAST SKEPTIK | 10:00–CLOSE | ends 23:00 |

Cheapest fix: find the outdoor curfew (one number covers both main-stage cases) and treat the club
afters as ending at 02:00.

### 3. Artist casing
The posters are set entirely in uppercase, so they carry no information about official
stylization. Rather than invent it, every name is stored exactly as printed. `JOHN-ROBERT` is
probably `john-robert`; `WET LEG`, `TINASHE`, `PARCELS`, `MALLRAT` etc. are probably title case.

**This is safe to defer.** UID normalization lowercases before hashing, so fixing casing later
changes display text only and orphans nobody's events.

---

## Publishing, when you're ready

The YAML carries `verified: false`. A production build refuses to run:

```
$ npm run build -- --production
Refusing to publish … — `verified: true` is not set.
```

The gate also fires automatically on Vercel, because production deploys set `VERCEL_ENV=production`.

To publish:

1. Check `data/capitol-hill-block-party-2026.yaml` against the two poster images.
2. Resolve the items above.
3. Set `verified: true` at the top of the YAML.
4. Bump `publishedAt` in `state/published.json` (it's the revision stamp — it becomes DTSTAMP and
   LAST-MODIFIED, and it exists so the build never reads the wall clock).
5. `npx vercel deploy --prod --scope lunde-os`
6. `npm run smoke -- https://stagetimes.app`

---

## Domain — not connected yet

`stagetimes.app` currently resolves to a **GoDaddy** parking page:

```
NS   ns35/ns36.domaincontrol.com
A    13.248.243.5, 76.223.105.230
```

The brief assumed registering at Vercel so DNS auto-configures. Since it's at GoDaddy, pick one:

1. **Point GoDaddy DNS at Vercel** — add apex `A 76.76.21.21`, add the domain in Vercel, let it
   issue the cert. Registrar stays GoDaddy. Fastest.
2. **Move nameservers to Vercel** — matches the brief, no manual records, but a propagation window.

Add the **apex only**, not `www`: `webcal://` scheme-swaps against the same host, so there should
be exactly one canonical form to print on a subscribe button.

`.app` is HSTS-preloaded — browsers refuse plain HTTP with no click-through. Run
`curl -I https://stagetimes.app/` and confirm valid TLS before sharing any URL with anyone.

---

## Deployment Protection — read before testing a subscription

The project has **SSO protection on, scoped to `all_except_custom_domains`**. Consequences:

- **Preview URLs are behind an auth wall.** A calendar client fetching a preview feed gets an HTML
  login page instead of ICS. Verified: an anonymous request to the preview feed returns `302` to
  `vercel.com/sso-api`.
- **The production apex will be unaffected** once the custom domain is attached — the setting
  explicitly excludes custom domains. No change needed for launch.

I did **not** change this setting; it's a security setting on your account. If you want to test an
actual subscribe-on-phone flow against a preview, either turn SSO protection off for previews or
use a protection-bypass token.

Feed correctness at the CDN was verified through an authenticated fetch instead:

```
HTTP/2 200
content-type: text/calendar; charset=utf-8
cache-control: public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400
etag: "169c1f7c9098aad6b10647fcea14c58a"
x-content-type-options: nosniff
```

…and the fetched bytes are identical to the local build.

---

## Things I changed from the brief, and why

1. **`vercel.json` as written in the brief does not deploy.** It lacks `outputDirectory` (Vercel
   defaults to `public/`; we build to `dist/`, so every feed would 404) and `buildCommand` (so the
   test gate wouldn't run). Its `"/(.*).ics"` also treats `.` as regex-any. All three fixed.
   `$comment` keys are rejected by Vercel's schema, so the rationale lives here instead.

2. **The UID formula has a collision hole.** `sha1(slug + year + stage + artist)` deliberately
   excludes start time so sets can move — correct. But it means **one artist playing the same
   stage twice collapses into a single event**, silently dropping a set. CHBP doesn't trip it
   (MGNA CRRRTA and NICKCHEO each play two *different* stages), but the build now hard-fails on
   duplicate UIDs rather than losing data. If a real festival ever double-books a stage, the
   formula needs a discriminator — and that's a permanent decision.

3. **Added the `verified` publish gate.** Not in the brief. Ingest is the one non-deterministic,
   untested step in an otherwise fully-tested pipeline, and a wrong set time is silent and
   unfixable for existing subscribers. Fail-safe by omission: you must type `verified: true`.

4. **`DTSTAMP` comes from committed state, not the clock.** RFC 5545 says DTSTAMP is
   object-creation time, but determinism is what the entire test strategy rests on.

5. **Fixtures moved out of `data/`** into `tests/fixtures/`, so `data/` holds only real,
   publishable festivals. A fixture sitting beside real data is one wrong flag away from being
   deployed as though it were a schedule.

---

## Design system

`.claude/skills/stage-times-design/` — load it before touching any HTML or CSS.

Structure is **measured** from the 236 Cash App screenshots (52pt buttons, radius = height/2,
16/8pt spacing module, two type sizes carrying 80% of the UI, no shadows, no gradients). Color
comes from the Fritz screenprint reference: cream `#FCF9F4`, vermillion `#EC300C`, golden
`#ECCC0C`, royal `#045CAC`.

Worth knowing: **the CHBP posters are already in this idiom** — cream paper, flat saturated blocks,
chunky uppercase grotesque, zero gradients. The palette and the source material agree.

Two bugs found by screenshotting and fixed: the All Stages button was invisible (tonal button on a
tonal card), and cream-on-vermillion card text measured 4.0:1 — below AA at 16px. Stage 1 now uses
`#C42408` (5.5:1) while the hero keeps the brighter vermillion, where 56px display type only needs
3:1.

---

## Suggested next session

1. Send Friday's schedule → re-transcribe → rebuild.
2. Resolve the six `CLOSE` end times.
3. Decide the domain path (GoDaddy DNS vs Vercel nameservers) and attach the apex.
4. Verify the transcription, set `verified: true`, deploy to production.
5. Subscribe on your own phone from the apex and confirm it renders in iOS Calendar.

Nothing is blocked on me; all four are decisions or inputs only you have.
