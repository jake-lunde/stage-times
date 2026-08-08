# Stage Times

**Set times, by stage.** — [stagetimes.app](https://stagetimes.app)

One iCalendar subscription feed per festival stage, so an attendee subscribes to the two or three
stages they care about and gets each as a distinct, individually-colorable, toggleable calendar.

The insight the architecture rests on: **iCalendar has no field for "which calendar does this event
belong to."** Calendar assignment happens at subscribe time, one target calendar per feed URL.
Per-stage calendars are therefore only expressible as N separate feeds. That's the product.

Current session status and open decisions: **[HANDOFF.md](./HANDOFF.md)**.

---

## ⚠️ The permanence contract — read before changing anything

Published feed URLs are **permanent and unmigratable**. Once someone subscribes you cannot reach
into their calendar to update the URL, and no redirect is reliably followed for a subscription. A
URL change is a silent, unfixable break for every existing subscriber.

Three things are frozen from first publish. Changing any of them orphans existing subscribers'
events:

| Frozen | Where | What breaks if changed |
|---|---|---|
| **`UID_DOMAIN`** (`stagetimes.app`) | `src/ics.ts` | Every event gets a new UID. Subscribers keep the old events forever *and* get duplicates. This is an identity namespace, not a hostname — it stays even if the site moves hosts. |
| **UID derivation** — `sha1(slug + year + stageId + normalizedArtist)`, including the exact `normalizeArtist` implementation | `src/ics.ts`, `src/schema.ts` | Same as above. Note the normalization (NFD → strip combining marks → lowercase → trim → collapse whitespace) is part of the contract. |
| **Stage `id`** | `data/*.yaml`, `state/published.json` | That stage's feed URL 404s for everyone already subscribed. |

**Stage `id` is a permanent URL slug. Stage `name` is display text.** They are separate fields for
exactly this reason: the festival can rename "Main Stage" to "Coors Light Main Stage" and you
change `name` freely while `id` stays `main` forever.

The build enforces this — it refuses to run if a slug in `state/published.json` is missing from the
YAML, because that means a rename or deletion and it needs a human decision, not a silent 404.

**UID deliberately excludes the start time.** Festivals move sets constantly; the same UID with a
new `DTSTART` updates in place for every subscriber. A time-derived UID would create a duplicate
and leave the stale event behind — the most common failure in published feeds.

> **Known limitation.** Because UID excludes start time, one artist playing the *same stage* twice
> collapses into a single event. The build hard-fails on duplicate UIDs rather than silently
> dropping a set. Fixing it properly requires adding a discriminator to the UID — which is itself a
> permanent decision, so do it before first publish or not at all.

---

## How it works

Two phases, hard separation.

**Phase 1 — Ingest** (assisted, run once, output committed). Lineup images in
`_ref/set-screenshots/` are transcribed into a single hand-checkable
`data/<festival-slug>-<year>.yaml`. This uses vision and is **not part of the build**. The
transcription log with every ambiguity lives in `source/TRANSCRIPTION.md`.

**Phase 2 — Build** (deterministic, no model in the loop). `src/build.ts` reads the YAML and emits
static files. Given identical YAML and identical committed state it produces **byte-identical**
`.ics` output — no generation timestamps, no randomness, no network, no LLM. That is what makes
subscription updates safe and CI diffs meaningful.

```
dist/
  index.html
  <festival-slug>-<year>/
    index.html
    all.ics
    <stage-slug>.ics
  feeds.json
```

---

## Commands

```bash
npm test                       # 69 tests — all 8 validation gates
npm run build                  # build to dist/ (preview; allows unverified data)
npm run build -- --production  # refuses to build unless verified: true
npm run smoke -- <base-url>    # gate 8: curl each feed, assert headers + TLS
```

---

## Pushing a schedule change

1. Edit `data/<festival-slug>-<year>.yaml`.
2. Bump `publishedAt` in `state/published.json`. This is the revision stamp — it becomes `DTSTAMP`
   and `LAST-MODIFIED` on every touched event and `lastUpdated` on the page. It exists so the build
   never reads the wall clock. **If you don't bump it, the build warns that content changed but the
   stamp didn't advance.**
3. `npm test && npm run build` — check the `dist/` diff. Feeds are diffable on purpose.
4. Deploy. `SEQUENCE` advances automatically for events whose content changed; clients ignore
   updates whose SEQUENCE hasn't advanced.

## Adding next year

1. New `data/<festival-slug>-<year>.yaml` — same `slug`, new `year`.
2. Set `default` in `state/published.json` to the new key.
3. Reuse the **same stage ids** where the stage is the same physical stage. New year = new URL
   path (`/chbp-2027/main.ics`), so last year's subscribers are untouched and unaffected.

## The `verified` gate

Ingest is the one non-deterministic, untested step in an otherwise fully-tested pipeline, and a
wrong set time in a published feed is silent and unfixable for anyone already subscribed. So the
YAML carries a `verified:` flag and a production build refuses to run while it is false or absent.

Fail-safe by omission — you have to type `verified: true` to publish. Vercel production deploys
set `VERCEL_ENV=production`, so the gate applies there without anyone remembering a flag.

---

## Hosting

Vercel, static output, apex `stagetimes.app`. Feeds are **not** generated from a serverless
function: the data only changes when the YAML changes, so on-request generation buys nothing and
costs the determinism the whole test strategy rests on.

`vercel.json` differs from the original brief in three ways, all required to actually deploy:

1. **`outputDirectory: "dist"`** — the project has no framework, so Vercel's default output
   directory is `public/`. Without this, deploys serve nothing and every feed 404s.
2. **`buildCommand: "npm test && npm run build"`** — makes the test gate explicit. A failing
   validation gate fails the deployment outright, which is stronger than a CI check you can merge
   past.
3. **`"source": "/(.*)\\.ics"`** — the brief's `/(.*).ics` treats `.` as regex-any, so it would
   also match `/fooXics`.

`$comment` keys are rejected by Vercel's schema validator, which is why this rationale is here.

**Deployment Protection.** SSO protection is enabled for `all_except_custom_domains`. Preview URLs
sit behind an auth wall, so a calendar client fetching a preview feed gets an HTML login page
instead of ICS. The production apex is unaffected. To test a real subscribe flow on a preview,
disable protection for previews or use a protection-bypass token.

**Never leave a subscription pointed at a preview URL** — preview deployments are ephemeral and
that feed will 404 later. Test on preview; subscribe for real only on the production apex.

---

## Validation gates

| # | Gate |
|---|---|
| 1 | Every generated `.ics` parses with an **independent** library (`ical.js`), with correct event counts and per-stage partitioning |
| 2 | Golden-file byte comparison against committed fixtures |
| 3 | UID stability — build twice for identical UIDs; mutate a time and assert UID unchanged while `DTSTART` and `SEQUENCE` change |
| 4 | URL stability — every published stage slug still exists in the YAML |
| 5 | Timezone — `VTIMEZONE` present, resolved UTC instants correct either side of a DST boundary |
| 6 | Raw-byte lint — line length ≤75 octets, CRLF, well-formed folding |
| 7 | Every set references a declared stage; every stage has ≥1 set |
| 8 | Post-deploy smoke — HTTP 200, `text/calendar; charset=utf-8`, ETag, valid TLS |

Gates 1–7 run in `npm test`. Gate 8 is `npm run smoke -- <url>`, run after deploy.

---

## Design

`.claude/skills/stage-times-design/` — load before touching any HTML or CSS.

Structure is measured from Cash App iOS screenshots; color is a four-color retro screenprint
palette. The short version: **big dumb buttons and minimal, super-clear text.**

---

Unofficial. Not affiliated with any festival.
