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
| **Edition `namespace`** (`owner` or `fan`) | `data/**/*.yaml`, `state/published.json` | Every feed URL under the edition moves between `/<key>/` and `/fan/<key>/` — 404 for everyone subscribed. See [ADR-0001](./docs/adr/0001-fan-namespace-prefix.md). |

**Stage `id` is a permanent URL slug. Stage `name` is display text.** They are separate fields for
exactly this reason: the festival can rename "Main Stage" to "Coors Light Main Stage" and you
change `name` freely while `id` stays `main` forever.

The build enforces this — it refuses to run if a slug in `state/published.json` is missing from the
YAML, or if an edition recorded there has no YAML that builds to its path (a deleted file, or a
changed `namespace:`), because that means a rename or deletion and it needs a human decision, not
a silent 404. To take an edition down, block it instead: [docs/takedown-runbook.md](./docs/takedown-runbook.md).

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

**Phase 2 — Build** (deterministic, no model in the loop). `src/build.ts` reads **every**
edition under `data/` and emits static files. Given identical YAML and identical committed state
it produces **byte-identical** `.ics` output — no generation timestamps, no randomness, no
network, no LLM. That is what makes subscription updates safe and CI diffs meaningful.

```
dist/
  index.html
  <festival-slug>-<year>/          owner edition   (namespace: owner)
    index.html
    all.ics
    <stage-slug>.ics
  fan/<festival-slug>-<year>/      fan edition     (namespace: fan)
    index.html
    all.ics
    <stage-slug>.ics
  feeds.json                       every edition: namespace, listed, blocked, feeds
```

### Editions and namespaces

An **edition** is one year of one festival: `data/<festival-slug>-<year>.yaml`, key
`<slug>-<year>`. Each edition declares which of the two URL families it lives in with a
top-level field, required, no default:

```yaml
namespace: owner    # feeds at https://stagetimes.app/<slug>-<year>/…
namespace: fan      # feeds at https://stagetimes.app/fan/<slug>-<year>/…
```

The root is owner-only; fan-uploaded editions live under `/fan/` and stay there even once
listed ([ADR-0001](./docs/adr/0001-fan-namespace-prefix.md)). The field is required rather than
defaulted because either default would be a permanent mistake by omission. By convention fan
YAMLs sit under `data/fan/`, but the field is the declaration — the build reads `data/**/*.yaml`
and places each edition by its `namespace:`. The same `<slug>-<year>` may exist once per
namespace; the **edition path** (`<key>` or `fan/<key>`) is what is unique, and it is the key
into both state files.

### Committed state: listed and blocked

`state/published.json` records, per edition path, the stage-slug ledger and two owner-controlled
flags:

```json
"fan/coachella-2027": {
  "slug": "coachella", "year": 2027, "namespace": "fan",
  "listed": false,
  "blocked": false,
  "stages": ["main", "outdoor"]
}
```

- **`listed`** — the owner's approval for the homepage. Always a human edit; the build writes
  `false` on an edition's first build and never changes it.
- **`blocked`** — the edition was taken down (a rights holder asked, or the uploader removed it).
  It still builds: every feed URL it ever served returns a valid calendar with zero events and
  its original calendar name, its page becomes the removed page, and `feeds.json` reports it
  `listed: false` whatever the flag above says. Setting it is the one-line takedown edit;
  unblocking is a `git revert`. Procedure: [docs/takedown-runbook.md](./docs/takedown-runbook.md).

`state/sequences.json` keeps the per-event SEQUENCE ledger **per edition path**, so an owner and
a fan edition of the same festival-year (which share UIDs — UID derivation is frozen and ignores
the namespace) keep separate histories. A blocked edition's ledger is left untouched.

---

## Commands

```bash
npm test                       # all 8 validation gates, pages, copy, editions, and the transcription seam
npm run build                  # build every edition to dist/ (preview; allows unverified data)
npm run build -- --production  # refuses to build unless every edition is verified: true
npm run build -- data/x.yaml   # build only the named file(s); add --dry-state for a fixture
npm run smoke -- <base-url>    # gate 8: curl every feed of every edition, assert headers + TLS
npm run ingest -- <image>      # source image → edition YAML + ambiguity log (calls the model)
npm run ingest:eval            # re-score the CHBP posters against the 79 hand-verified sets
npm run ingest:eval -- --trials 2 --record 2026-09-13   # …and rewrite the committed eval record
```

Transcription is a library: `transcribe()` in `src/transcription.ts` takes the raw model output
per source image and returns the validated edition document and the log, with no file or model
access inside it. `src/vision.ts` is the only module that calls a model; `npm run ingest` and the
eval are thin wrappers over both.

### Which model transcribes

Configuration, not code. `config/vision-models.json` names the default model, the fallback, and
the per-million-token price of every model the eval has scored; `src/models.ts` reads it and
`STAGE_TIMES_VISION_MODEL` (or `npm run ingest -- --model <id>`) overrides the default for one
run. When a call to the default model fails, the fallback — the proven model — transcribes
instead.

The current setting is [ADR-0002](./docs/adr/0002-transcription-model.md), decided on the numbers
in [`docs/evals/transcription-models.json`](./docs/evals/transcription-models.json): each model
transcribes the same three CHBP posters twice, and the default is the cheapest one that reproduces
all 79 hand-verified sets exactly in every trial. `npm run ingest:eval` regenerates them — over the
API only, since the local `claude` CLI bills a subscription and picks its own model, so it can
price nothing. The eval takes the measurement date as an argument because nothing here reads the
wall clock.

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

1. New `data/<festival-slug>-<year>.yaml` — same `slug`, new `year`, `namespace: owner`.
2. Reuse the **same stage ids** where the stage is the same physical stage. New year = new URL
   path (`/chbp-2027/main.ics`), so last year's subscribers are untouched and unaffected.
3. `npm run build` records the edition in `state/published.json` (unlisted). Set `listed: true`
   by hand when it should appear on the homepage. Last year's edition keeps building alongside
   it — nothing is ever a "default" edition.

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

## Secrets

Three environment variables exist on the Vercel project (production and preview), named in
`src/secrets.ts` and provisioned by the wizard:

```bash
scripts/provision-secrets.sh
```

| Name | What it is for | Where it comes from |
|---|---|---|
| `ANTHROPIC_API_KEY` | Vision calls for transcription bill the API, never a subscription | console.anthropic.com → API keys |
| `GITHUB_TOKEN` | The publisher commits edition YAML and opens listing pull requests | Fine-grained token: this repo only, Contents + Pull requests read/write |
| `OWNER_SECRET` | What the owner's bookmarked upload link is checked against | Generated by the wizard, 32 random bytes |

The wizard signs you in to the Vercel CLI, opens each page, captures the value, sets it for
both environments, and offers to rotate anything that already exists. Re-run it to rotate.
Nothing is committed, logged, or written to the vault; the API key alone is also written to a
gitignored `.env` so `npm run ingest` can use it locally.

`GET /api/health` reports which secrets the live deployment can read (booleans, never
values). `POST /api/health` with `{"owner": "<secret>"}` also proves each key works: it lists
models with the Anthropic key and reads the repo with the GitHub token. A wrong owner secret
gets exactly the GET response. The wizard's last stage polls this after a deploy.

## Validation gates

| # | Gate |
|---|---|
| 1 | Every generated `.ics` parses with an **independent** library (`ical.js`), with correct event counts and per-stage partitioning |
| 2 | Golden-file byte comparison against committed fixtures |
| 3 | UID stability — build twice for identical UIDs; mutate a time and assert UID unchanged while `DTSTART` and `SEQUENCE` change |
| 4 | URL stability — every published edition still builds to its path, in its namespace, and every published stage slug still exists in its YAML (blocked editions included) |
| 5 | Timezone — `VTIMEZONE` present, resolved UTC instants correct either side of a DST boundary |
| 6 | Raw-byte lint — line length ≤75 octets, CRLF, well-formed folding |
| 7 | Every set references a declared stage; every stage has ≥1 set; `namespace` is `owner` or `fan` |
| 8 | Post-deploy smoke — HTTP 200, `text/calendar; charset=utf-8`, ETag, valid TLS; a blocked edition's feeds are valid empty calendars and its page is the removed page |

Gates 1–7 run in `npm test`, alongside the page, copy, and edition tests (`tests/editions.test.ts`:
both namespaces side by side, byte-identical twice, blocked feeds and the removed page, the
manifest). Gate 8 is `npm run smoke -- <url>`, run after deploy.

---

## Design

`.claude/skills/stage-times-design/` — load before touching any HTML or CSS.

Structure is measured from Cash App iOS screenshots; color is a four-color retro screenprint
palette. The short version: **big dumb buttons and minimal, super-clear text.**

---

Unofficial. Not affiliated with any festival.
