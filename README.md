# Stage Times

**Set times, by stage.** — [stagetimes.app](https://stagetimes.app)

One iCalendar subscription feed per festival stage, so an attendee subscribes to the two or three
stages they care about and gets each as a distinct, individually-colorable, toggleable calendar.

The insight the architecture rests on: **iCalendar has no field for "which calendar does this event
belong to."** Calendar assignment happens at subscribe time, one target calendar per feed URL.
Per-stage calendars are therefore only expressible as N separate feeds. That's the product.

Where the work stands lives in the jaique vault (`docs/agents/issue-tracker.md`); the standing
facts and the working agreement are in **[HANDOFF.md](./HANDOFF.md)**.

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
> permanent decision, so do it before first publish or not at all. The transcription library
> works around it in the data instead (`disambiguateRepeats()`, 21 Sep 2026, when ACL's nightly
> silent disco and repeating kids' acts refused to publish): a repeat on one stage gets the day
> in its name, `SILENT DISCO (Friday)`, the date too when two of its days share a weekday,
> `(Friday Oct 2)`, and the printed start as well when two fall on one day.
> The name is what the calendar shows; the log and the review say it happened.
>
> A festival over two weekends — ACL, Coachella — is one edition, and a stage that plays both
> is **two stages**: `t-mobile-weekend-1` and `t-mobile-weekend-2`, each its own feed, each
> named with its weekend on the calendar. The same act on the same stage both weekends is then
> two events with two UIDs, because the stage id is in the UID. The weekend is in the id
> forever, like the rest of it; the stage's `weekend:` field is display only
> ([ADR-0004](./docs/adr/0004-weekend-scoped-stage-ids.md)). One run of days has no weekends.

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

Every edition is the owner's and lives at the root
([ADR-0005](./docs/adr/0005-every-edition-is-the-owners.md)). `/fan/` holds the one edition from
when anyone could publish, which keeps its URLs forever
([ADR-0001](./docs/adr/0001-fan-namespace-prefix.md)); nothing writes there again. The field is
required rather than defaulted because either default would be a permanent mistake by omission.
By convention fan YAMLs sit under `data/fan/`, but the field is the declaration — the build reads `data/**/*.yaml`
and places each edition by its `namespace:`. The same `<slug>-<year>` may exist once per
namespace; the **edition path** (`<key>` or `fan/<key>`) is what is unique, and it is the key
into both state files.

### Committed state: listed and blocked

`state/published.json` records, per edition path, the stage-slug ledger and two owner-controlled
flags:

```json
"coachella-2027": {
  "slug": "coachella", "year": 2027, "namespace": "owner",
  "listed": true,
  "blocked": false,
  "stages": ["main", "outdoor"]
}
```

- **`listed`** — the owner's approval for the homepage. Always a human act — his confirm, the
  merge of a watcher review, or a hand edit; the build writes `false` on an edition's first build
  and never changes it.
- **`blocked`** — the edition was taken down (a rights holder asked, or it moved).
  It still builds: every feed URL it ever served returns a valid calendar with zero events and
  its original calendar name, its page becomes the removed page, and `feeds.json` reports it
  `listed: false` whatever the flag above says. Setting it is the one-line takedown edit;
  unblocking is a `git revert`. Procedure: [docs/takedown-runbook.md](./docs/takedown-runbook.md).
- **`movedTo`** — on a blocked edition only: the edition path its set times moved to. Its page
  then says *Moved* and its one pill goes there; its feeds stay empty, because a calendar cannot
  be moved. The build refuses one on an unblocked edition, or naming an edition it does not
  publish unblocked. The first: the fan ACL 2026 edition, moved to `austin-city-limits-2026`
  when every edition became the owner's (22 Sep 2026).

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
npm run look-ahead             # open this month's look-ahead issue (the 1st of each month, scheduled)
npm run look-ahead -- --dry-run --on 2026-10-01   # …or print it, as that day's run would write it
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

Every edition is the owner's ([ADR-0005](./docs/adr/0005-every-edition-is-the-owners.md)).
`src/publisher.ts` is the one seam that makes one: an **intent** plus injected ports for vision,
repository writes, notifications, the clock and randomness go in, and the writes it would make
come out. Nothing in it reads a file, calls a model, opens a socket or looks at a clock, so every
rule below is tested with fakes and no API key (`tests/publisher.test.ts`).

Three intents exist — `upload`, `link` and `confirm` — and every one carries the owner's secret
from his bookmarked link, `/upload/#owner=<secret>`. The **owner port** checks it against
`OWNER_SECRET` in constant time, **before any other gate**: a missing, wrong, empty or
unconfigured secret is refused (`owner`, HTTP 403) before a field is judged, a name resolved, a
page fetched, a model asked or a byte written. The **watcher** (`src/watcher.ts`) is the same
shape from the other side: the same ports plus one for pages, and its reviews carry the edition
exactly as the owner's confirm would commit it. The **signal** (`src/signal.ts`) is a third, for
festivals the watcher cannot read. Procedure and secret rotation:
[docs/owner-runbook.md](./docs/owner-runbook.md).

**`upload`** — the source images, one per day in day order, plus a festival name and dates. One
image is a list of one. The gates run cheapest first and stop at the first failure, so a
rejection never costs a call it did not have to make:

| # | Gate | Costs |
|---|---|---|
| 1 | the owner's secret | nothing |
| 2 | what was typed: name, dates, zone | nothing |
| 3 | at most 7 images, none twice; each one's type, size (10 MB), dimensions (400–8000 px) | nothing |
| 4 | content-hash lookup per image — the same image is never read twice | nothing |
| 5 | "is this a schedule with times on it", for each image not read before | the `screen` model |
| 6 | transcription, for each image not read before | the `default` model |

Every image clears gate 5 before any image reaches gate 6, so a retry that adds day three to two
days already read costs one check and one transcription. A rejection about one image of several
starts `Day 2:` and carries the image's position; the others are not read until it is fixed.

Every rejection is one or two plain sentences, written under the copy rules and passed to the
screen untouched. What comes back is a **review payload** — one set list across every day, every
set with its inferred-end flag, a look-here flag where the model said it was unsure of the line
(and its few words why), the printed time, and the image it was read from, and the time zone:
the festival's own when it is on record in the almanac, else the default, marked as assumed.

**`link`** (ticket 19) — the festival's schedule page, and nothing else typed. The link has to be
a public http(s) web address, and every address its host resolves to has to be public too — a
private, loopback or link-local address is refused before anything is asked of it (`publicLink()`
and `isPublicAddress()` in `src/web.ts`), and the live port refuses one again at connect time on
every redirect. The page is read the way the watcher reads one (`imageUrlsIn()`); every image on
it is fetched and dropped by the size in its header when it cannot be a schedule; at most the
upload image limit are kept, the largest first, and the review's notes say when more were left
out. Each survivor then takes an uploaded image's own path: the transcription store (a hit is a
schedule and costs nothing), the schedule check — a no drops that image, not the link, and is
remembered in `state/screened.json` so the same page never pays to ask again — and the
transcription. What comes back is exactly the review an upload of the same images gives, read
with the name and year printed on them and the link as the official schedule, plus the days read
and the fetched images; confirm is the upload's confirm and takes those images back, so the
stored source images are the bytes the page served and a later screenshot of the same poster is
free. A link that is not a public page, a page that does not answer, a login wall, and a page
with no schedule on it each come back as one sentence pointing at screenshots.

**`confirm`** — the review with its corrections, and the same images echoed back with the
review's list of image hashes; a list that differs in any image or in order is refused. The
edition is rebuilt from the saved model reply (never from anything the browser sends back), the
corrections are applied and recorded in the transcription log, and the result goes through the
real schema loader on its way out: if it would not build, it is not committed. One commit to
`main` carries `data/<key>.yaml`, its log (which names every source image), every stored source
image named by content hash, and the state update recording `<key>` with **`listed: true`** —
the owner's tap is the approval — and opens nothing and tells no one. An edition already at that
path is refused, never replaced or suffixed. **The publish stamp is the injected clock** — the one
place a real time enters the system, and it enters as committed state, so the build still never
reads a wall clock.

Changing a published edition is the watcher's review of a change on its schedule page, or a hand
edit to the YAML ("Pushing a schedule change", below). Nothing in the publisher replaces one.

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
SEQUENCE for exactly the events that changed. A new reading keeps the live edition's stage ids
and names and its `city`: a stage whose id or name the owner picked by hand carries
`read_as:`, the id a reading derives for it (`titos-weekend-1` reads as
`tito-s-handmade-vodka-weekend-1`), and `transcribe()` maps it back. A change before the first review is merged
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

### The look-ahead

Once a month, what is coming (ticket 13). `config/festivals.yaml` is the **almanac**: the big
festivals, each with its source page, zone, the form its set times take (`poster`, `web`, `app`,
`social`, `unknown`), and one record per edition: its days and, once it has happened, the day its
set times dropped. `.github/workflows/look-ahead.yml` runs `npm run look-ahead` at 15:00 UTC on
the 1st, and `lookAhead()` in `src/look-ahead.ts` (notify and clock ports, nothing else) sends one
`look-ahead` issue titled `Look-ahead for <Month> <Year>: <first day> to <last day>`: every
almanac edition whose first day falls in the next ninety days, counting the run's day, with its
dates, the drop expected at the previous edition's lead (`Around 14 Aug (8 weeks ahead, as in
2025)`, or *No earlier drop on record*), the source form, and whether `config/watch.yaml` has it.
An unwatched edition gets a checkbox and the exact watch entry to append, its window opening a
week before the expected drop — or eleven weeks before the first day when there is nothing to go
by — and never before the run's day. A festival whose next days are not in the almanac shows up
as *Not on record* when last year's days come round, so the almanac gets fixed rather than the
edition missed. It guesses no date, writes no state, and calls no model.

### The state the publisher owns

| File | What it is |
|---|---|
| `state/published.json` | the confirm records the edition, listed, and moves `publishedAt` to its stamp. Nothing about who: it is always the owner. |
| `state/transcriptions/<hash>.json` | the model's reply for one image, verbatim, under that image's content hash. This is what makes a retry free. |
| `source/images/<hash>.<ext>` | the stored source image. Never served. |
| `source/<key>/TRANSCRIPTION.md` | the edition's log, with every correction made on review. |
| `state/screened.json` | every image a link's schedule check said no to, by content hash, so the same page is never asked about twice. Written only when the check said no. Nothing in the build reads it. |
| `state/signal.json` | every subreddit post the signal has sent the owner, per edition, by post id. Written only when a post was sent. Nothing in the build reads it. |
| `state/watch.json` | what the watcher has seen on each watched page: every image by content hash with its one-time schedule verdict, and the schedule images as of the last drop or change. Written only when an image is new. Nothing in the build reads it. |

### Over HTTP

`api/upload.ts`, `api/link.ts` and `api/confirm.ts` are three thin adapters: read the fields, call the publisher,
return what it said. `src/publisher-http.ts` holds what they share (field readers, the base64
image, the gate-to-status-code map) and `src/ports.ts` holds the live ports — GitHub's Git Data
API for the commit (one tree per intent, because a half-applied publish is an edition whose feeds
exist and whose state does not) and for the watcher's review pull requests, the web a link points at
(`liveWeb()`: redirects followed by hand, every connection through a resolver that refuses a
non-public address), a GitHub issue for the
notification (its title and body and nothing else — the repository is public), `OWNER_SECRET`
for the owner port, and `src/vision.ts` for both model calls. A test asserts the adapters import
nothing but those three modules. All three take `owner`, and without the right one answer 403.
Upload and confirm take an `images` list or a single `image`; confirm takes the review's hashes
back as `reviewed`, and a rejection about one image carries its position as `image`. Link takes
`url` and answers with the review, `officialUrl`, `days`, and `images` in the same shape confirm
reads them; confirm also takes `days` back, the days as checked, one per day read, and a day that differs moves every set printed under it and the year
with it (ticket 20). All three stream on request (tickets 20 and 21): with
`Accept: application/x-ndjson` every report the publisher makes through its optional `progress`
port goes out as one `{"progress": …}` line while it works — a link's page being opened and the
images found on it, an image cleared the schedule check,
an image's reading is in hand (with the sets so far and that image's headliners), confirm is
checking, saving, done — and the last line is exactly the body a plain request gets. The status
is then 200, sent before the answer is known; without the header nothing changes.

### The screens

`/upload/` is the owner's page, one static page rendered by `src/upload-pages.ts` (ticket 08): the
link, details, the images, review, the wait, success. Every screen ships hidden; the script reads
the owner's secret from the fragment (or the tab's session storage, after a reload) and shows the
link screen, or sends the visitor home without it. The front door is the link (ticket 20): the
festival's schedule page, one pill, and a text button to the screenshot flow, which is the details
screen and everything after it. A link's review carries the name, the year
and the days as read as fields above the sets, with the address the page will live at under
them — a changed name or year changes the address as it is typed, and confirm gets the name and,
when a day was moved, the `days`. Every answer to a link lands back on the link screen in the
publisher's sentence. A one-day festival is one file action that posts the moment an
image is chosen; more days is a row per day (ticket 18), every day shown from the start, each
swappable until the read starts, and one pill that reads whatever was chosen — a day with no times
yet can be left out. While the model reads, and again while confirm saves, the page draws the wait
as the beads of a stage card with no sets yet (`loadingArt()`, a ring per day) over a status line
that says only what the publisher has reported: while reading, a percentage of images done over
images sent and the sets read so far, with each image's headliners appearing in the center of the
art as it is read, one at a time, in the stage card's poster block (`posterBlock()`); while
saving, the step confirm is on. The clock estimates nothing; a browser that cannot read a stream
gets the answer whole, as before. A source with no web
address printed on it comes back as the `link` gate, which reveals the one field for it on the
form. The script reads fields, checks type and dimensions with the publisher's own limits
before posting, shrinks each image to its share of the platform's body cap, posts to the
adapters (`image` for one, `images` in day order for more, and confirm echoes the review's
`reviewed` list), and shows one screen at a time; every rejection is the publisher's sentence,
landed on the screen that can fix it (`GATE_SCREENS`), and one about a single image of several
lands under that day's row. The review shows each day's image above the sets read off it, every
row labeled with the night it belongs to. After confirm the page waits for the edition's own
`all.ics` to answer, and after five minutes says so instead of pretending. `tests/upload-page.test.ts` pins the static markup;
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

`vercel.json` differs from the original brief in five ways, all required to actually deploy:

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
5. **`functions."api/*.ts".maxDuration: 300`** — one upload is a schedule check and then a
   transcription of every image, and one confirm is a chain of Git Data API calls; either can run
   past the platform's default budget for a function. Without this a slow poster is a timeout
   that the page reports as "didn't go through", after the model call was billed.

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
| `GITHUB_TOKEN` | The publisher commits edition YAML and state to `main` | Fine-grained token: this repo only, Contents read/write (Pull requests no longer needed: ADR-0005) |
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
