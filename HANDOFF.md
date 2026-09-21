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
  poster colors), 08 (upload, review and success screens — Jake's lane). 06 and 07 are done.
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
