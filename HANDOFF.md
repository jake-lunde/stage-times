# Stage Times — session handoff

**Date:** 6 September 2026 (supersedes the 9 Aug handoff)
**Repo:** `/Users/jake/Documents/github/stage-times`
**Production:** https://stagetimes.app — **LIVE**, last deployed from `f714be4` (9 Aug); nothing from 6 Sep is deployed yet
**Vercel project:** `stage-times` @ LUNDE OS (`prj_mbuC9M3JFa5BMrEajeneh0vtLeHJ`)
**GitHub:** https://github.com/jake-lunde/stage-times (a push to `main` triggers a production deploy)
**Tracker:** the jaique vault — `Efforts/On/🎪 Stage Times (E).md` and the numbered tickets in
`Efforts/Notes/Stage Times/`. See `docs/agents/issue-tracker.md`. The vault, not this file, is
the source of truth for what is next; this file is the orientation.

**2026-09-20, ticket 08 — the upload flow is built and merged to `main` locally, not pushed.** `/upload/`
is one static page, five screens (`src/upload-pages.ts`), pinned by `tests/upload-page.test.ts`; the smoke
test checks it live and takes `VERCEL_AUTOMATION_BYPASS_SECRET` for a protected preview. Reviewed on two
axes (standards, spec) and the findings applied: the gate sentences now live once in `src/publisher.ts`
(`GATE_COPY`, `EMAIL_RE`) and are injected into the page; a corrected start can cross midnight
(`editedStart`/`editedEnd`, tested, embedded by source); the review says where the page will live. Checked
at 320px in headless Chrome, not yet on a real phone against a real deploy — that is the first preview's
smoke. For 09 and 10: the update link shape is `updateLink()` in `src/upload-pages.ts`
(`/update/<edition path>/#<secret>`); nothing links to `/upload/` yet — the homepage or the footer is the
owner's call; the build wait polls the page's own origin, so on a preview it always ends at "Nearly there".
Left for later, deliberately: the day-rolling for time edits is a browser-side reading of a time picker
(the publisher's `SetEdit` takes wall time); moving it into the publisher means changing 07's seam.

**2026-09-21, ticket 11 — the drop watcher, merged to `main` (`1abfaca`), not pushed.** `src/watcher.ts`
is the publisher seam from the other side: `watch({kind: 'watch', list}, ports)` over the publisher's
ports plus a page port. Per due entry it reads every image on the schedule page, decides each new one
once (free gates, then the cheap check; verdicts committed to `state/watch.json`), and compares the
schedule images as a set with last time: same is nothing, first is a drop, different is a change. A
drop or a change is transcribed through the same library and schema as an upload (`namespace: owner`,
`verified: true`), diffed against what is live (`diffSets()`), and opened as a review pull request off
the run's one state commit; **merging is the check** and publishes and lists through the owner path.
Cadence: hourly inside the entry's drop window, daily (15:00 UTC run) before it, never after the last
day; the job is `.github/workflows/watch.yml` on an hourly cron with no server. Watch list:
`config/watch.yaml` — ACL 2026 (weekend two, `match: Wk2`; the images are already posted, so the first
run will open that review), III Points 2026 (the lineup page; no schedule page exists yet) and Camp Flog
Gnaw 2026 (same). Verified against the live ACL page without spend: the extractor finds exactly the
three Wk2 images and the header parser reads their sizes. Runbook: `docs/watcher-runbook.md`. Tests:
`tests/watcher.test.ts`, the page-port and issue cases in `tests/ports.test.ts`; 377 pass. **Before it runs:**
`ANTHROPIC_API_KEY` must exist as a GitHub Actions repository secret (the wizard now sets it, or
`gh secret set`), and the workflow only exists once `main` is pushed. **Owner calls:** the daily slot
(15:00 UTC); whether a page unreachable for days should notify (it is silent); whether a self-superseded
review should be closed by the watcher (it is left open); the ACL weekend choice.

**2026-09-21, ticket 12 — the Reddit signal, on branch `ticket/12-reddit-signal`.** `src/signal.ts` is
the third intent through the seam: `signal({kind: 'signal', list}, ports)` over the publisher's ports plus
a Reddit port. A watch entry may name `subreddit:`; inside the entry's drop window (hourly cadence only;
`--force` for any non-dormant entry) the hourly job, after the watcher, reads the subreddit's `new.json`
once per run and sends a `signal` issue — title `Set times on Reddit: <Festival> <Year>`, body the post
link, nothing else — for each post about set times, posted inside the window, naming no other year, with
≥10 votes; each post once, ever (`state/signal.json`). The live port (`liveReddit()`) sends
`web:app.stagetimes.signal:v1.0 (+https://stagetimes.app)`, spaces requests 6 s, and stops for the run
after a 429 or a spent `x-ratelimit-remaining`. Tests: `tests/signal.test.ts`, the Reddit cases in
`tests/ports.test.ts`; 391 pass. **Found while building:** Reddit answered this machine's unauthenticated
`.json` requests with a 403 block page (its RSS answered 200), so the public JSON may be refused from
GitHub Actions too — the run log would say `unreachable` and nothing else. **Owner calls:** which
subreddits to watch (none are in `config/watch.yaml`; `r/ACL` is a knee-injury subreddit, and the III
Points and Camp Flog Gnaw guesses did not answer); whether to register a Reddit app for OAuth if the public
JSON stays blocked; the vote threshold (10); a Reddit username for the User-Agent's `(by /u/…)`.

**2026-09-21, ticket 13 — the monthly look-ahead, on branch `ticket/13-monthly-ninety-day-helper`.**
`src/look-ahead.ts`: `lookAhead({kind: 'look-ahead', almanac, list}, {notify, clock})` sends one
`look-ahead` issue per run, `Look-ahead for <Month> <Year>: <from> to <to>` — every edition in the
new almanac (`config/festivals.yaml`) starting in the next ninety days, with dates, the drop
expected at the previous edition's lead, source form and watched status, and for an unwatched one a
checkbox and the exact `config/watch.yaml` entry. `.github/workflows/look-ahead.yml` runs it at
15:00 UTC on the 1st; the first scheduled run is 1 Oct 2026 and covers October and November
(`npm run look-ahead -- --dry-run --on 2026-10-01` prints it). Tests: `tests/look-ahead.test.ts`.
**The almanac holds only what was on record** (the spec's 2026-09-06 dates and the watch list): no
2025 edition or drop date is in it, so every first-run row says *No earlier drop on record*, and
this session had no web access to check more. **Owner calls:** review the first run and add
watchers from it (EDC Orlando and Corona Capital are unwatched; on 2026-09-21 EDC Orlando's source
moved to `https://orlando.edc.com/`, whose page gives 6–8 Nov 2026; Corona Capital's page answers
but its text does not give the dates; the derived slugs `edc-orlando`, `corona-capital` are the
owner's to confirm, as they are permanent once published); fill in 2025 drop dates and more festivals; the
source form for III Points, Camp Flog Gnaw and Corona Capital (`unknown`); whether the almanac
should be refreshed by a model or a scheduled agent rather than by hand.

 — multi-day uploads through the publisher, on branch
`ticket/17-multi-day-uploads-through-the-publisher`.** Both intents take `images` (day order; the
old `image` is a list of one and reads exactly as before). Each image is gated, hashed and cached
on its own; every unread image clears the schedule check before any is transcribed; the caps
count the request; `MAX_UPLOAD_IMAGES` is 7. The review is one set list across every day, each
set carrying `image` (its hash) and the review carrying `images`; confirm needs that list back
as `reviewed` for more than one image, stores every image, and records `images` on the uploader
record. `BuiltSet.source` in the library says which source a set was read from. Tests:
`tests/publisher-days.test.ts`. **Not done:** the `/upload/` page still sends one image — taking
several (and saying "Day 2:" on the right one) is screen work, Jake's lane. Owner calls: the
limit of 7, and the worst-day spend it implies (20 uploads × 7 images, against the ~$5 the caps
were sized for).

**2026-09-21, ticket 10 — the owner path, merged to `main` (`ebb05eb`).** Both intents take
an optional `owner` secret; the publisher asks a new **owner port** (`envOwner()` over
`ownerMatches()`) and, on a yes, publishes into the root with `listed: true` in the one commit,
with no pull request and no notification. Every no is a fan, indistinguishably. A fan confirm
opens a listing pull request (`list/fan/<key>`, one-line diff, branched off the publish commit —
`RepositoryPort.commit` now returns the commit id); if it will not open, the confirm still
succeeds and the notification says to list by hand. The page reads `#owner=` from the fragment,
clears it from the address bar, and sends it with both posts — no visible change. Runbook with
rotation: `docs/owner-runbook.md`. Tests: `tests/publisher-owner.test.ts`, `tests/ports.test.ts`,
the owner cases in `tests/publisher-http.test.ts` and `tests/upload-page.test.ts`. **Owner calls:**
whether the upload caps should exempt the owner (they apply today; the global 20/day could lock
you out on a drop day); whether an owner re-upload of an existing root edition should become a
correction (refused today — left as it stands through the merge). Unprobed live: pull-request
write on the real token.

**2026-09-21, ticket 09 — correction and self-removal through the update link, on branch
`ticket/09-correction-and-self-removal-via-the-upda`, with `main` (and so ticket 10) merged
into it.** Upload and confirm take an optional
`update: {editionPath, secret}`; when its hash matches the edition's `uploader.secretHash`
(`claimedEdition()`), confirm replaces that edition's YAML and log in place under the same slug,
year and stage ids and moves `publishedAt` — the build's ledger then bumps only changed events. A
wrong or absent secret is a fresh (suffixed) upload. A listed edition's correction sends an
`edition-corrected` notification with a per-set diff (`diffSets()`); an unlisted one sends none. A
correction may not drop a published stage or change year (refused in words). New `remove` intent
and `api/remove.ts`: `blocked: true`, image kept, wrong secret refused. The build writes
`/update/fan/<key>/` per fan edition (`renderUploadPage(edition)`). Tests:
`tests/publisher-correction.test.ts`, plus the adapter and page suites. **Owner calls:** whether a
self-removal should notify him (it doesn't; the commit says "self-removal"); whether an uploader
can undo their own removal through the link (they can't — unblocking stays a revert); the update
page's copy (Jake's lane — shipped as drafted in `screens.md`).

**Where the two paths meet.** The page never sends both secrets: the owner bookmark is
`#owner=<secret>` on `/upload/` and the update link is a bare `#<secret>` on
`/update/<edition path>/`, so `ownerFromFragment()` reads nothing on an update page and
`updateClaim()` is undefined on the upload page. The publisher still decides an intent that
carried both, and it decides it once: **a held update link wins.** `namespaceOf()` takes the
claimed edition and returns *its* namespace, because an edition never moves between namespaces
(the permanence contract, ADR-0001), and the correction path returns no listing pull request —
it changes the times of an edition already published and leaves `listed` as it found it. Nothing
else about either ticket changed in the merge. 351 tests pass; CHBP feeds are byte-identical.

Status: **everything from 6 Sep sits on `main` unpushed** — the morning's glossary, ADR, and copy
review, plus tickets 02, 04, and 15. Nothing user-facing changes until Jake pushes.

---

## What happened 2026-09-20 (ticket 06, Fable)

**The homepage is the directory.** `renderLandingPage(site, { images })` in `src/pages.ts`
renders one shelf card per listed edition — `listedEditions()` filters `listed && !blocked` and
orders by first festival day, then name, then path — after the unchanged red hero and a
two-sentence section header. The whole card is the link to the edition's page in its
namespace. Each card: eyebrow (`Aug 7–9, 2026 · Seattle`; on a fan edition the `Fan-made` mark
in `--red-deep` takes the slot and the dates drop to the first quiet line), the festival name,
`79 sets across 4 stages.`, the first stage's billed headliners, then art to the bottom edge:
the committed image from `assets/festivals/`, else `facetsArt()` — the explorer's Facets core,
the disco ball, seeded by festival key, on the light ground of the first stage color. The old
featured card, `featuredEdition()`, `renderPages()`, and `capsuleArt()` are gone.

Rulings applied: one 18px `--r-card` on every card and tile on both page types
(`--r-card-media` retired; stage cards moved from 24, compact cards from 16); the Store
density tokens (`--pad-shelf` 28, `--gap-shelf` 20 — the stage carousel inherits it —,
`--gap-section`, `--h-shelf-card` 450/500, `--w-shelf-card` = viewport − margins − 24px peek,
400 from 735px); `city:` is an optional display-only field under `festival:` (CHBP says
Seattle, no `publishedAt` bump — no feed byte moved); `shortDates()` is the eyebrow form.
The shelf keeps one left edge with the header and the prose and runs to the viewport's right
edge, so a 1024 desktop shows two cards and a phone one with the 24px peek.

Tests: **257 pass**. `tests/landing.test.ts` covers count, order, links, the fan mark, the
city, the radius token, the Facets fallback (same bytes twice), the density tokens, and the
copy rules; the smoke test now asserts the live homepage carries one card per listed edition.
All five CHBP feeds are byte-identical to the previous build. Verified in the browser at 375
and 1024, light and dark.

**Three taste calls for Jake** (his lane; each a one-line edit in `renderLandingPage` /
`directoryCard` / `shortDates`): the section header line — shipped as *Pick a festival.* /
*Then add the stages you want.* (the Store-density draft *Listed festivals.* fails `copy.md`:
"listed" is glossary vocabulary); the quiet line, shipped as the main stage's billed
headliners rather than the draft's *Fri–Sun. Pacific time.*; and the year in the eyebrow —
shipped as `Aug 7–9, 2026` per the audit's block-out, where the ruling's example was
`AUG 7–9`. The year is there so two years of one festival read as two cards.

---

## What happened 2026-09-06

The morning session (Opus) settled the glossary (`CONTEXT.md`), the agent docs, ADR-0001, and
the fifteen-ticket plan for the self-serve editions spec, then did ticket 01. The afternoon
session (Fable) verified 01 and shipped 02, 04, and 15.

1. **Ticket 01 — copy review** (`docs/copy-review-2026-09-06.md`). All 49 visible strings read
   by three festival-goers; 17 rewrites; the "Add calendar" ruling confirmed. Verified against
   the source and the built pages: the inventory is complete, the contract claims hold (artist
   casing is UID-safe because normalization lowercases; the calendar name is not frozen).
2. **Ticket 15 — the rewrites are live on the pages** (`ef2d8bd`). Every button says
   "Add calendar". The Android dead-tap recovery line renders hidden under each button and
   appears when "Opening Calendar…" restores itself. Footers read "Wrong time? Tell me ↗"; the
   landing footer gained attribution; the stamp says "Pacific" via `zoneLabel()` in `pages.ts`
   (derived from the IANA zone, no data change). Disposition of all 17 rewrites is section 6 of
   the review. Declined here: R6 (artist title case), R16 (calendar-name apostrophe), R17
   (shorter inferred-end caveat) — all change feed bytes or data and are owner calls.
   `tests/copy.test.ts` pins the strings and the voice rules.
3. **Ticket 02 — transcription is a library** (`15fd0f3`). `transcribe(outputs, options)` in
   `src/transcription.ts` takes the model's raw replies and returns the validated edition
   document, its YAML, the ambiguity log, and per-set review detail. Pure: no files, no model,
   no network, no clock. `src/vision.ts` is the only thing that talks to a model;
   `src/ingest.ts` (`npm run ingest`) and `tests/ingest-eval.ts` (`npm run ingest:eval`) are
   wrappers. The eval replays saved replies from `_ref/ingest-eval/raw/` and scores 79/79.
   The old `stage-times-ingest` worktree is removed.
4. **Ticket 04 — every edition builds, with listed and blocked state** (`8b0836b`, merge).
   The build walks `data/**`. Owner editions build to `/<slug>-<year>/`, fan editions to
   `/fan/<slug>-<year>/`; the YAML declares which with a required `namespace:` field.
   `state/published.json` is keyed by edition path and carries `listed` and `blocked`;
   `state/sequences.json` is per edition. A blocked edition serves every feed it ever had as a
   valid empty calendar with its original name, and its page is the removed page ("Taken
   down"). `docs/takedown-runbook.md` is the procedure. The transcription library learned the
   namespace field in the merge (`--namespace owner|fan` on the CLI, default `fan`).

Tests: **155 pass** (`npm test`). CHBP feeds are byte-identical to the last deploy.

## Rulings that changed since the 9 Aug handoff

All from the 6 Sep grilling; recorded on the vault effort page and, where permanent, as ADRs.

- **Fan editions live under `/fan/`; the root is owner-only.** ADR-0001. Permanent.
- **No draft tier.** A feed URL that exists is one a human checked. The old "draft /
  uploader-verified / listed" table is gone; the states are `listed` and `blocked`.
- **Uploaders can edit a set on review.** The image stays the source of truth.
- **The homepage becomes a list of listed editions** (ticket 06). The no-directory rule is
  revoked; no admin UI and no database still stand.
- **One pipeline, two entry points.** Jake uploads through the same screens as a fan,
  recognized by a secret bookmark (ticket 10). No separate scraper.
- **"Add calendar", not "Subscribe."** Live as of ticket 15.
- **Takedowns: block first, talk after.** Feeds go empty, URLs never 404.
- **GitHub is the alert channel; the vault is the tracker.** Nothing here becomes a vault
  ticket unless Jake asks.

## The frontier (read the vault for the full tickets)

- **Ready now:** 14 (sponsor card and the festival footer link), 16 (stage subtitle line and
  poster colors), 18 (multi-day upload screens — Jake's lane), 12 (Reddit signal) and 13 (monthly
  helper) once 11 is merged. 06, 07, 08, 09, 10, 11 and 17 are done.
- **Waiting on Jake:** 03 (provision secrets: vision API key, GitHub token, owner secret). It
  gates 05 (pick the transcription model on evidence) and 08 (upload, review, success screens).
- **Owner calls outstanding:** the rights-holder takedown email address (G2 — the footer line
  ships the moment it exists); a device check of the iOS confirm sheet's wording for R13; R6,
  R16, R17 above; and the push (eleven commits, `git log origin/main..main`).

## Flags for whoever picks up 07

- **Where do source images live?** The runbook says a rights-holder block deletes the stored
  image "in the same commit". If images are committed to this public repo, that is not a
  deletion — history keeps it. They need a private store. Decide before the first upload.
- `npx serve` (the `.claude/launch.json` preview) 404s nested `/fan/<key>/` paths; Vercel and
  the build are fine. Preview fan editions another way or accept the quirk.
- A bare `assert.ok(x)` with no message costs about three minutes on failure under `tsx`
  while Node re-parses the source for the message. Give assertions messages.

## Working agreement (owner, 2026-08-09, still in force)

Delegate non-taste builds to agents in their own worktrees; taste work (new screens, copy)
stays in the main session. Merge to `main` locally is fine; **push decisions stay with Jake.**
Verify work done by a different model before building on it. New screens come from
`.claude/skills/stage-times-design/` (load `references/copy.md` before writing any string),
not from generic taste.

## What NOT to do

- No database until a phase demonstrably cannot ship without one.
- Never auto-list. Never delete a published slug. Never let the build read the wall clock.
- Never change `normalizeArtist`, UID derivation, `UID_DOMAIN`, a stage `id`, or an edition's
  `namespace` after first publish.
- Don't put a feed URL, a repo path, or the word "we" on a page.

## Housekeeping

- Merged branches that can be deleted: `feat/ingest-library`, `feat/editions-state`,
  `feat/ingest-cli`, `feat/analytics`, `feat/design-refresh`, `docs/agent-setup`.
- Agent worktrees under `.claude/worktrees/` are gitignored; `git worktree prune` after
  removing the directories.
- `webcal://` first hop is plain http → one-time "Insecure Connection" prompt on Apple
  devices. Deliberate.
- Carry-over: nine inferred CLOSE ends stand unless a real curfew surfaces; official schedule
  deep link unconfirmed.
