# Stage Times — session handoff

**Date:** 6 September 2026 (supersedes the 9 Aug handoff)
**Repo:** `/Users/jake/Documents/github/stage-times`
**Production:** https://stagetimes.app — **LIVE**, last deployed from `f714be4` (9 Aug); nothing from 6 Sep is deployed yet
**Vercel project:** `stage-times` @ LUNDE OS (`prj_mbuC9M3JFa5BMrEajeneh0vtLeHJ`)
**GitHub:** https://github.com/jake-lunde/stage-times (a push to `main` triggers a production deploy)
**Tracker:** the jaique vault — `Efforts/On/🎪 Stage Times (E).md` and the numbered tickets in
`Efforts/Notes/Stage Times/`. See `docs/agents/issue-tracker.md`. The vault, not this file, is
the source of truth for what is next; this file is the orientation.

Status: **everything from 6 Sep sits on `main` unpushed** — the morning's glossary, ADR, and copy
review, plus tickets 02, 04, and 15. Nothing user-facing changes until Jake pushes.

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

- **Ready now:** 06 (homepage lists listed editions), 07 (publisher seam: upload and confirm),
  14 (sponsor card and the festival footer link).
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
