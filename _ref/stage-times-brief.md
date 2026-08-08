# Stage Times — build brief

**Product:** Stage Times
**Tagline:** Set times, by stage.
**Domain:** `stagetimes.app`
**Hosting:** Vercel (static output), apex domain
**Scope:** One festival, end to end, publicly usable

## Fill these in before starting

- `FESTIVAL_NAME`:
- `FESTIVAL_SLUG` (kebab-case, permanent — see URL contract):
- `FESTIVAL_YEAR`:
- Dates (first/last day, local):
- Timezone (IANA, e.g. `America/Chicago`):
- Official schedule URL (for attribution/verification):
- Stages (names exactly as printed on the official schedule):
- Lineup source: screenshots in `./source/screenshots/`

---

## What we're building

A static site publishing **one iCalendar subscription feed per festival stage**, so an attendee
subscribes to the two or three stages they care about and gets that stage's set times as a
distinct, individually-colorable, toggleable calendar in Apple Calendar, Google Calendar, or
Outlook. Model the distribution UX on F1, sports league, and conference calendars: a landing
page listing feeds, each with a one-tap subscribe link.

The insight driving the architecture: **iCalendar has no field for "which calendar does this
event belong to."** Calendar assignment happens at subscribe time, one target calendar per feed
URL. Per-stage calendars are therefore only expressible as N separate feeds. That's the product.

Do not build a multi-festival directory, an admin UI, or a database. Keep the pipeline
data-driven enough that next year is a new YAML file, but don't generalize past that.

---

## URL contract — read this first, it constrains everything

Published feed URLs are **permanent and unmigratable**. Once someone subscribes, you cannot
reach into their calendar to update the URL, and there is no redirect mechanism a calendar
client will reliably follow for a subscription. A URL change is a silent, unfixable break for
every existing subscriber.

Canonical structure:

```
https://stagetimes.app/<festival-slug>-<year>/<stage-slug>.ics
https://stagetimes.app/<festival-slug>-<year>/all.ics
https://stagetimes.app/<festival-slug>-<year>/          # subscribe page
https://stagetimes.app/                                 # index / about
```

Rules that follow from this, all of which the builder must enforce:

- **Stage `id` is a permanent URL slug. Stage `name` is display text.** These are separate
  fields for exactly this reason: the festival can rename "Main Stage" to "Coors Light Main
  Stage" and you update `name` freely, while `id` stays `main` forever. Never rename an `id`
  after publish.
- Slugs are lowercase kebab-case, ASCII only, no dates or years inside the stage slug.
- Build fails if any published slug in `state/published.json` is missing from the current YAML —
  that's a rename or deletion, and it needs a human decision, not a silent 404.
- Serve over the apex `stagetimes.app`, not `www`. Shorter, and `webcal://` scheme-swaps against
  the same host so there's one canonical form to print.

---

## Architecture: two phases, hard separation

### Phase 1 — Ingest (assisted, run once, output committed)

Read the lineup screenshots in `./source/screenshots/` and produce a single hand-checkable
`data/<festival-slug>-<year>.yaml`. This phase uses your vision capability; it is a **one-time
authoring step, not part of the build.** The YAML is the source of truth, committed and reviewed
by a human before any feed is generated.

Requirements:

- Print a transcription of every screenshot before writing YAML, so the reads can be diffed
  against the images.
- Flag every low-confidence read explicitly — ambiguous times, cut-off artist names, unclear
  stage assignment — as a `# TODO:` comment on the exact line, plus a summary list at the end of
  the run. Do not silently guess. A wrong set time in a published feed is the worst failure mode
  this project has.
- Normalize artist names but preserve official casing and stylization (`SOPHIE`, `black midi`,
  `¡Aparato!`). Keep the raw OCR string alongside if you corrected it.
- Resolve the post-midnight problem: a set listed under "Friday" at `1:30 AM` is Saturday's
  calendar date. Schedules print this inconsistently. Resolve to absolute local datetimes in the
  YAML — no relative-to-festival-day encoding — and comment which entries you shifted.
- Where an end time isn't printed, infer from the next set on that stage and mark
  `end_inferred: true`. If it's the last set of the night, default to 60 minutes and flag it.

Schema:

```yaml
festival:
  name: ""
  slug: ""            # permanent, appears in every URL
  year: 2026
  timezone: "America/Chicago"
  official_url: ""
stages:
  - id: "main"            # PERMANENT url slug — never change after publish
    name: "Main Stage"    # display text — safe to change anytime
    description: ""       # optional, shown on subscribe page
sets:
  - stage: "main"
    artist: "Artist Name"
    start: "2026-08-14T19:30:00"   # local wall time, no offset
    end:   "2026-08-14T20:45:00"
    end_inferred: false
    notes: ""
```

### Phase 2 — Build (deterministic, no model in the loop)

A script (`build.py` or `build.ts` — pick whichever has the better iCalendar library) reading
the YAML and emitting static files. Given identical YAML it must produce byte-identical `.ics`
output. No generation timestamps in event bodies, no randomness, no network calls, no LLM. This
is what makes subscription updates safe and CI diffs meaningful.

```
dist/
  index.html
  <festival-slug>-<year>/
    index.html
    all.ics
    <stage-slug>.ics
```

---

## iCalendar correctness requirements

These are what actually break real-world subscription feeds. Treat each as a test, not a hope.

**Frozen UID domain.** `UID` = `sha1(festival-slug + year + stage-id + normalized-artist)` with
right-hand side `@stagetimes.app`, declared as a single constant:

```
UID_DOMAIN = "stagetimes.app"   # FROZEN. Never change, even if the site moves hosts or domains.
                                # This string is an identity namespace, not a hostname.
```

Decoupling it from the live hostname means a future domain change doesn't orphan a single
existing event. Put that comment in the code.

**UID must not include the start time.** Festivals move sets constantly. Same UID with a new
`DTSTART` updates in place for every subscriber. A time-derived UID creates a duplicate and
leaves the stale event behind — the single most common failure in published feeds.

**SEQUENCE and LAST-MODIFIED.** Increment `SEQUENCE` when an event's content changes relative to
the last published feed. Commit `state/sequences.json` so the builder can compute this across
runs. Clients ignore updates whose SEQUENCE hasn't advanced.

**Timezones.** Emit `DTSTART;TZID=<IANA zone>` with a real embedded `VTIMEZONE` covering the
festival dates including any DST transition. Not floating local time (breaks for anyone whose
device is in another zone), not UTC-only (correct but unreadable when debugging).

**Calendar naming.** `X-WR-CALNAME` = `<Stage name> — <Festival> <YY>`, e.g. `Main Stage —
ThatFest 26`. Stage first because that's what disambiguates in a sidebar list, and iOS truncates
early. Put the brand in `X-WR-CALDESC`: `<Festival> <Year> set times for <Stage>. stagetimes.app`.
Also set RFC 7986 `NAME` and `DESCRIPTION` alongside the legacy `X-WR-*` properties.

**PRODID.** `-//Stage Times//stagetimes.app//EN`

**Refresh hints.** `REFRESH-INTERVAL;VALUE=DURATION:PT12H` plus legacy `X-PUBLISHED-TTL:PT12H`.
Apple respects these. Google ignores them and refreshes on its own schedule, often 12–24h,
sometimes worse. Say so honestly on the subscribe page rather than implying instant updates.

**Formatting.** CRLF line endings. Fold at 75 octets on octet boundaries, not character
boundaries — multi-byte artist names corrupt otherwise. Escape `,` `;` `\` and newlines in
`SUMMARY`, `DESCRIPTION`, `LOCATION`.

**Event fields.**
- `SUMMARY`: artist name only. The calendar is already named for the stage; repeating it burns
  the ~20 characters iOS gives you in month view.
- `LOCATION`: stage name. Safety net for anyone importing several feeds into one calendar, and
  it populates Apple/Google's location row.
- `DESCRIPTION`: stage, set time, `end_inferred` caveat if applicable, link to official schedule.
- `STATUS:CONFIRMED`, `TRANSP:TRANSPARENT` (a set shouldn't mark the user busy), no `VALARM` —
  never ship default alerts on a subscribed calendar, it's hostile.

**No `METHOD:PUBLISH`.** Including it makes some clients treat the file as an iTIP invitation
import rather than a subscribable calendar.

---

## Landing + subscribe pages

Static self-contained HTML, no framework, no external requests. Brand is "Stage Times" with the
tagline "Set times, by stage." Keep it plain and fast; this page gets loaded on festival wifi.

Per stage: name, set count, day span, a `webcal://` subscribe button, and a copyable `https://`
URL. Plus the combined `all.ics`.

Platform reality to design around and state plainly in the UI:

- **iOS / macOS** — `webcal://` works directly, one tap, prompts to subscribe. Happy path.
- **Google Calendar** — cannot add a calendar by URL from the Android or iOS app at all.
  **Desktop web only:** Settings → Add calendar → From URL, with the `https://` link. Print the
  exact menu path. A subscribe button that silently no-ops on Android generates every support
  question you'll get.
- **Outlook** — web and desktop accept the `https://` URL under Add calendar → Subscribe from web.

Include an honest note that overlapping sets compress into narrow columns in day view, so two or
three stages reads well and eight does not — the tradeoff versus a printed clashfinder grid.
Recommend per-stage feeds for following specific stages and link the official schedule for a
full-lineup grid.

Also: last-updated timestamp, "unofficial, not affiliated with the festival," attribution to the
official schedule as source, and a one-line "found an error?" contact or issue link.

---

## Hosting, domain, HTTPS

Vercel, apex `stagetimes.app`, domain registered at Vercel so DNS is auto-configured — no manual
A records, no `CNAME` file, TLS provisioned in minutes rather than up to a day.

**Still ship static output.** Do not generate feeds from a serverless function. The data only
changes when the YAML changes, so on-request generation buys nothing and costs the determinism
the whole test strategy rests on — byte-identical output, golden-file comparison, diffable
feeds in version control. Build to a directory, let Vercel serve it as static assets on the CDN.

- **`.app` is HSTS-preloaded**, so browsers refuse plain HTTP with no click-through. Vercel
  provisions the cert automatically and quickly, but still `curl -I https://stagetimes.app/` and
  confirm valid TLS before sharing any URL with anyone. A URL shared during a cert gap looks
  fully broken, not merely insecure.
- **Set the content type explicitly** in `vercel.json` — do not rely on extension sniffing:

```json
{
  "cleanUrls": true,
  "headers": [
    {
      "source": "/(.*).ics",
      "headers": [
        { "key": "Content-Type", "value": "text/calendar; charset=utf-8" },
        { "key": "Cache-Control", "value": "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400" }
      ]
    }
  ]
}
```

  Vercel adds ETags to static assets automatically, so well-behaved clients get 304s and the
  bandwidth cost stays near zero.

- **Make the build command run the tests**: `npm test && npm run build`. A failing validation gate
  then fails the deployment outright, which is stronger than a CI check you can merge past.
- **Preview deployments are the real win here.** Every branch gets a live HTTPS URL, so you can
  actually subscribe on your own phone and inspect how the calendar renders before anything hits
  production. Use this — it's the only way to catch client-specific rendering problems.
- **Gotcha: Vercel Deployment Protection.** Preview URLs sit behind an auth wall by default,
  which means a calendar client fetching a preview feed gets an HTML login page instead of ICS.
  Either disable protection for previews or use a protection-bypass token when testing feed
  fetches. Expect to hit this and be confused by it once.
- **Never leave a subscription pointed at a preview URL.** Preview deployments are ephemeral;
  that feed will 404 later. Test on preview, subscribe for real only on the production apex.
- Instant rollback is a genuine safety lever for this product: if bad set times ship, roll back
  the deployment and correct feeds propagate on clients' next poll.
- Traffic model is polling, not pageviews — a few KB per feed, fetched every few hours per
  subscriber. Even at thousands of subscribers this stays trivially inside the Hobby tier, which
  is fine for a free non-commercial project.

---

## Validation gates

1. Parse every generated `.ics` with an independent library (not the one that wrote it); assert
   event count, per-stage partitioning, and that no event ends before it starts.
2. Golden-file test: committed expected `.ics` for a small fixture festival, byte-compared.
3. UID stability: build twice, assert identical UIDs. Then mutate a set's time in the fixture and
   assert the UID is unchanged while `DTSTART` and `SEQUENCE` change.
4. URL stability: assert every stage slug present in `state/published.json` still exists in the
   YAML. Fail loudly on any disappearance.
5. Timezone: assert `VTIMEZONE` present, and that an event's resolved UTC instant matches the
   expected wall time — including a case either side of a DST boundary if the festival spans one.
6. Raw-byte lint for line length, CRLF, and folding.
7. Every `sets` entry references a declared stage id; every declared stage has ≥1 set.
8. Post-deploy smoke against the deployed URL: `curl -I` each feed, assert HTTP 200,
   `content-type: text/calendar; charset=utf-8`, an `ETag` present, and valid TLS. Run it against
   the preview URL on every PR and against the apex after production deploys.

---

## Deliverables

1. `data/<festival-slug>-<year>.yaml` — transcribed lineup, uncertain reads flagged.
2. A transcription log plus a summary list of every ambiguity, for human verification before publish.
3. Deterministic build script.
4. Landing page and per-festival subscribe page.
5. `vercel.json` with headers config, plus build/test wiring so a failed gate fails the deploy.
6. Test suite covering the gates above.
7. `README.md` covering: how to push a schedule change, how to add next year, and the permanence
   contract — UID derivation, `UID_DOMAIN`, and stage slugs are all frozen after first publish,
   with an explicit warning that changing any of them orphans existing subscribers' events.

## Order of work

Ingest the screenshots and show the transcription first. **Stop there and wait for confirmation
before building anything** — set times need verifying against the images before a single feed
exists. Then build, test, confirm HTTPS is live, then publish.
