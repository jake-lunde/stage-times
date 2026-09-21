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
npm test                       # the 8 validation gates, pages, copy, editions, transcription, and the publisher
npm run build                  # build every edition to dist/ (preview; allows unverified data)
npm run build -- --production  # refuses to build unless every edition is verified: true
npm run build -- data/x.yaml   # build only the named file(s); add --dry-state for a fixture
npm run smoke -- <base-url>    # gate 8: curl every feed of every edition, assert headers + TLS
npm run ingest -- <image>      # source image → edition YAML + ambiguity log (calls the model)
npm run ingest:eval            # re-score the CHBP posters against the 79 hand-verified sets
npm run ingest:eval -- --trials 2 --record 2026-09-13   # …and rewrite the committed eval record
npm run watch                  # the watcher, then the signal: poll what is due on this run (calls the model on a drop)
npm run watch -- --due         # …or just say which entries would be polled now
npm run watch -- --force       # …or poll every entry whose festival is not over
```

Transcription is a library: `transcribe()` in `src/transcription.ts` takes the raw model output
per source image and returns the validated edition document and the log, with no file or model
access inside it. It also takes the review screen's corrections and the `verified:` flag, so the
publisher and the CLI produce the same YAML by the same rules. `src/vision.ts` is the only module
that calls a model; `npm run ingest`, the eval, and the publisher's vision port are thin wrappers
over both.

### Which model transcribes

Configuration, not code. `config/vision-models.json` names the default model, the fallback, the
small `screen` model that answers the publisher's pre-spend "is this a schedule" question, and the
per-million-token price of every model the eval has scored; `src/models.ts` reads it and
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

## Phase 3 — the publisher

Anyone with a set-times image can publish a fan edition. `src/publisher.ts` is the one seam that
does it: an **intent** plus injected ports for vision, repository writes, notifications, the clock
and randomness go in, and the writes and notifications it would make come out. Nothing in it
reads a file, calls a model, opens a socket or looks at a clock, so every rule below is tested
with fakes and no API key (`tests/publisher.test.ts`).

Three intents exist today — `upload`, `confirm` and `remove` — each of the first two with an
owner variant, and upload and confirm carrying an update link are a correction. The **watcher**
(`src/watcher.ts`) is the same shape from the other side: the same ports plus one for pages, and
its reviews carry the edition exactly as the owner's confirm would commit it. The **signal**
(`src/signal.ts`) is a third, for festivals the watcher cannot read.

**`upload`** — the source images, one per day in day order, plus a festival name, dates and a
contact address. One image is a list of one. The gates run cheapest first and stop at the first
failure, so a rejection never costs a call it did not have to make:

| # | Gate | Costs |
|---|---|---|
| 1 | what the uploader typed: name, dates, address, zone | nothing |
| 2 | at most 7 images, none twice; each one's type, size (10 MB), dimensions (400–8000 px) | nothing |
| 3 | content-hash lookup per image — the same image is never read twice | nothing |
| 4 | caps: 3 uploads per address per hour, 20 per day across everyone — an upload is one request, however many images | nothing |
| 5 | "is this a schedule with times on it", for each image not read before | the `screen` model |
| 6 | transcription, for each image not read before | the `default` model |

Every image clears gate 5 before any image reaches gate 6, so a retry that adds day three to two
days already read costs one check and one transcription. A rejection about one image of several
starts `Day 2:` and carries the image's position; the others are not read until it is fixed.

The caps sit ahead of the schedule check rather than behind it: that check is a model call, and a
gate whose job is to bound spend cannot spend to run. Every rejection is one or two plain
sentences, written under the copy rules and passed to the screen untouched. What comes back is a
**review payload** — one set list across every day, every set with its inferred-end flag, a
low-confidence flag where the model singled the read out, the printed time, and the image it was
read from, and the time zone marked as assumed.

**`confirm`** — the review with the uploader's corrections, and the same images echoed back with
the review's list of image hashes; a list that differs in any image or in order is refused. A set
they could not verify blocks it.
The edition is rebuilt from the saved model reply (never from anything the browser sends back),
the corrections are applied and recorded in the transcription log, and the result goes through the
real schema loader on its way out: if it would not build, it is not committed. One commit to
`main` carries the edition YAML, its log (which names every source image), every stored source
image named by content hash, and the state update. **The publish stamp is the injected clock** — the one place a real time enters the
system, and it enters as committed state, so the build still never reads a wall clock.

A fan intent writes `data/fan/` and `fan/<key>` and nothing else; the root namespace is
owner-only. A second upload for a festival-year someone else already published gets a suffixed
slug (`low-tide-2`), because nobody is blocked by another fan's work.

**The owner path** (ticket 10). Both intents take an optional `owner` secret — the owner's
bookmarked link, `/upload/#owner=<secret>`, which the page reads from the fragment and sends
with each post. When the **owner port** recognizes it (`OWNER_SECRET`, constant time), the same
confirm writes `data/<key>.yaml`, records `<key>` with `listed: true` in the same commit, and
opens nothing: the owner's tap is the approval. A root edition already there is refused, never
replaced or suffixed. A wrong, missing or unconfigured secret is no secret — the intent is a
fan's and the response is byte-for-byte a fan's. A fan confirm, after its publish commit, opens
a **listing pull request** on the owner's behalf: branch `list/fan/<key>` off the publish
commit, titled `List <Festival> <Year>`, its body the page link and the set count, its only
change `listed: true` on that edition. Merging it from the GitHub app lists the edition on the
next build and moves no feed byte. A pull request that will not open never fails the confirm;
the notification says to list by hand. Procedure and secret rotation:
[docs/owner-runbook.md](./docs/owner-runbook.md).

The **update link** secret is minted from the injected randomness, returned once in the confirm
response, and stored only as a SHA-256 hash. The contact address is stored only as a hash too —
this repository is public — and reaches the owner through the notification instead.

### The update link: correction and self-removal

Holding the update link is what makes someone an edition's uploader. Upload and confirm take it
as `update: {editionPath, secret}`; the publisher hashes the secret and compares it with the
edition's `uploader.secretHash` (`claimedEdition()`). When it holds, the upload's review says
`correcting: true` and the confirm is a **correction**: the edition's YAML and log are replaced
in place under the same slug, year and stage ids — so every UID a subscriber holds is still that
set's UID — and `publishedAt` moves to the injected clock. The build's sequence ledger then
advances SEQUENCE for exactly the events whose content changed. The publisher never writes
`state/sequences.json`.

- A correction cannot drop a stage that was ever published (gate 4 would refuse the build); it is
  refused in words instead. An image that reads as another year is refused too.
- If the edition is **listed**, the owner gets an `edition-corrected` notification carrying a
  per-set diff (`diffSets()`, keyed as the UID is). Nothing waits on him. An unlisted edition's
  correction notifies nobody.
- A **wrong or absent secret never touches an existing edition.** It is a fresh upload, and gets
  a suffixed slug like any second upload of a festival-year; the review says where it will live.
- A correction stays in the namespace it was published in and opens **no listing pull request**:
  the link names a fan edition that already exists, `listed` is left exactly as it was, and an
  `owner` secret sent alongside a link that holds changes neither. The owner path is for making
  an edition; the update link is for changing one.

**`remove`** takes only the update link. It sets `blocked: true` — the takedown runbook's one-line
edit, `listed` left alone — and keeps the stored source image; a wrong secret is refused and
writes nothing. The next build serves empty calendars and the removed page. A taken-down edition's
link can no longer correct it.

The link itself is `https://stagetimes.app/update/<edition path>/#<secret>`. The build writes one
page there per fan edition (`renderUploadPage(edition)`): the upload flow, but naming the festival
and what a new screenshot replaces before anything is uploaded, with "Take it down" behind a text
button. The secret is the fragment, so it never reaches a server log.

### The watcher

The automation that notices a drop, or a change after a drop, on a festival's official schedule
page (CONTEXT: watcher). The owner names the festivals in `config/watch.yaml` — festival, year,
the schedule page, the zone, the days and the drop window; adding one is adding an entry — and
`.github/workflows/watch.yml` runs `npm run watch` every hour with no server to keep alive.
Which entries a run polls is the cadence: **hourly inside the drop window, daily before it (the
15:00 UTC run), never after the festival's last day** (`cadenceOf()`, `isDue()`).

One poll of one entry (`watch()` in `src/watcher.ts`, over the publisher's ports plus a page
port):

1. fetch the page and list every image it shows (`imageUrlsIn()`: the share image, CSS
   backgrounds, `img` and `source` with the largest `srcset` candidate, lazy `data-src`, links
   straight to an image), narrowed by the entry's `match` when it has one;
2. hash each image; an image seen before is already decided;
3. a new image goes through the free gates (`imageDimensions()` reads the size off the header,
   then the publisher's type, size and dimension checks) and then, and only then, the cheap
   "is this a schedule" check — **once, ever, per distinct image**; the verdict is committed;
4. the schedule images as a set against the set recorded last time: the same set is nothing;
   a first set is a **drop**; a different set is a **change**;
5. a drop or a change is transcribed (each image once, ever — the publisher's store, so an
   upload of the same image is free afterwards and vice versa), read through the same library
   and schema as an upload with `namespace: owner` and `verified: true`, and offered as a
   **review pull request**: branch `watch/<key>/<12 hex of the image hashes>` off the run's
   state commit, carrying `data/<key>.yaml`, the log, every source image, and
   `state/published.json` with the edition recorded `listed: true`. **Merging it publishes and
   lists the edition through the owner path; merging is the human check.** Nothing is
   published by a poll.

What the review says depends on what is live. An edition not yet published gets the whole
schedule in the body — every set by stage and day with its inferred-end and look-here flags,
the model's notes, each image inline from the branch, and a link to the log — titled
`Set times dropped: <Festival> <Year>`. A **change to a live edition** is a per-set diff against
the committed YAML (`diffSets()`, keyed as the UID is), titled with what moved
(`<Festival> <Year>: <artist> moved, <artist> added`), whose commit replaces the YAML and log
in place under the same slug and stage ids and moves `publishedAt`, so the build advances
SEQUENCE for exactly the events that changed. A change before the first review is merged
replaces that review: a new branch, the whole schedule again, and what moved since the earlier
reading. A new image that reads the same as what is live (or as the earlier reading) is a
change with nothing to review, recorded and not asked about again.

What stops a review, and tells the owner why in a `watch-failed` issue with the image links:
images that read as another year than the entry watches; a reply the library or the schema
refuses; a change that would drop a stage the live edition has (gate 4 would refuse the build);
a review pull request that will not open (the issue carries what it would have said). A blocked
edition gets no review. An unreachable page is reported and writes nothing; so does a page that
has not changed — **an hourly poll of a quiet page is free and leaves no trace.**

Procedure — adding a festival, verifying from the phone, running it by hand, the secrets:
[docs/watcher-runbook.md](./docs/watcher-runbook.md). The first three entries are ACL, III
Points and Camp Flog Gnaw for 2026; ACL's page carries both weekends and one edition is one
weekend (the same artist on the same stage twice collides on UID — the known limitation above),
so its entry matches `Wk2`.

### The signal

For a festival whose set times only appear in an app or a social post (CONTEXT: signal). A watch
entry may name the festival's subreddit (`subreddit: <name>`); the same hourly job, after the
watcher, reads each named subreddit's newest posts **inside the entry's drop window only**, through
Reddit's public JSON listing with no credentials (`signal()` over the publisher's ports plus a
Reddit port). A post fires when its title is about set times (`SET_TIMES_RE`: set times, stage
times, timetable, schedule), it was posted inside the window, it names no other year, and it has
at least `SIGNAL_MIN_VOTES` (10). Each post fires **once, ever**: the owner gets a `signal` issue
titled `Set times on Reddit: <Festival> <Year>` whose body is the post's reddit.com link and
nothing else, and the post id is recorded in `state/signal.json`. A notice that will not send is
not recorded, so the next run sends it. No image is fetched, no model is called, nothing is
created; the owner goes and gets the screenshot and uploads it through the bookmark.

Staying inside the public endpoint's limits: one request per subreddit per run (entries that
share a subreddit share it), six seconds between requests, and nothing more this run after a 429
or once `x-ratelimit-remaining` reaches zero. It says who it is: `web:app.stagetimes.signal:v1.0
(+https://stagetimes.app)`. An unreachable subreddit is reported in the run log and writes
nothing.

### The state the publisher owns

| File | What it is |
|---|---|
| `state/published.json` | gains an `uploader` record per fan edition: secret hash, address hash, the confirm's stamp, the first source image hash (and `images`, every one in order, when there was more than one). A correction replaces the image hashes and adds `correctedAt`. Its presence is what *uploader-verified* means. The build carries it forward and never writes it. |
| `state/uploads.json` | what the caps count. Not a log — entries older than 24 hours are dropped on every write. |
| `state/transcriptions/<hash>.json` | the model's reply for one image, verbatim, under that image's content hash. This is what makes a retry free. |
| `source/images/<hash>.<ext>` | the stored source image. Never served. |
| `source/fan/<key>/TRANSCRIPTION.md` | the edition's log, with every correction made on review. |
| `state/signal.json` | every subreddit post the signal has sent the owner, per edition, by post id. Written only when a post was sent. Nothing in the build reads it. |
| `state/watch.json` | what the watcher has seen on each watched page: every image by content hash with its one-time schedule verdict, and the schedule images as of the last drop or change. Written only when an image is new. Nothing in the build reads it. |

### Over HTTP

`api/upload.ts`, `api/confirm.ts` and `api/remove.ts` are three thin adapters: read the fields, call the publisher,
return what it said. `src/publisher-http.ts` holds what they share (field readers, the base64
image, the gate-to-status-code map) and `src/ports.ts` holds the live ports — GitHub's Git Data
API for the commit (one tree per intent, because a half-applied publish is an edition whose feeds
exist and whose state does not) and for the listing pull request, a GitHub issue for the
notification, `OWNER_SECRET` for the owner port, and `src/vision.ts` for both model calls. A test
asserts the adapters import nothing but those three modules. Upload and confirm take an optional
`owner` secret and an optional `update` link; remove requires the link. Both adapters
take an `images` list or a single `image`; confirm takes the review's hashes back as `reviewed`,
and a rejection about one image carries its position as `image`.

### The screens

`/upload/` is one static page rendered by `src/upload-pages.ts` (ticket 08): details, one file
action, review, the wait, success. The script reads fields, checks type and dimensions with the
publisher's own limits before posting, shrinks a photo to fit the platform's body cap, posts to
the two adapters, and shows one screen at a time; every rejection is the publisher's sentence,
landed on the screen that can fix it (`GATE_SCREENS`). The update link is
`https://stagetimes.app/update/<edition path>/#<secret>` — decided in `updateLink()` there; the
page it opens is the same flow for that edition (above). After confirm the page waits for the edition's own `all.ics` to answer, and after
five minutes says so instead of pretending. `tests/upload-page.test.ts` pins the static markup;
the smoke test checks the page on a live deployment (set `VERCEL_AUTOMATION_BYPASS_SECRET` to
smoke a protected preview).

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

The homepage is the directory: one card per listed edition, earliest first festival day first,
then name; nothing unlisted or blocked. A card shows the edition's committed image from
`assets/festivals/<key>.<ext>` when one exists, else generated art seeded by the festival key.
An optional `city:` under `festival:` joins the dates in the card's eyebrow. It is display only
— never in a feed, a UID, or a slug — so it may change freely and needs no `publishedAt` bump.

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

`vercel.json` differs from the original brief in four ways, all required to actually deploy:

1. **`outputDirectory: "dist"`** — the project has no framework, so Vercel's default output
   directory is `public/`. Without this, deploys serve nothing and every feed 404s.
2. **`buildCommand: "npm test && npm run build"`** — makes the test gate explicit. A failing
   validation gate fails the deployment outright, which is stronger than a CI check you can merge
   past.
3. **`"source": "/(.*)\\.ics"`** — the brief's `/(.*).ics` treats `.` as regex-any, so it would
   also match `/fooXics`.
4. **`functions."api/*.ts".includeFiles: "config/**"`** — the publisher reads
   `config/vision-models.json` at call time (which model reads a source is configuration, not a
   literal). Without this the functions deploy without it and every upload fails on a missing file.

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
both environments, and offers to rotate anything that already exists. Re-run it to rotate. It
also sets `ANTHROPIC_API_KEY` as a **GitHub Actions repository secret** for the hourly watcher
(`.github/workflows/watch.yml`); the watcher's `GITHUB_TOKEN` is the workflow's own, with
contents, pull-requests and issues write permission declared in the workflow.
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
