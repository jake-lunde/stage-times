# Stage Times — session handoff

**Date:** 9 August 2026 (supersedes the 8 Aug evening handoff)
**Repo:** `/Users/jake/Documents/github/stage-times`
**Production:** https://stagetimes.app — **LIVE**
**Vercel project:** `stage-times` @ LUNDE OS (`prj_mbuC9M3JFa5BMrEajeneh0vtLeHJ`)
**GitHub:** https://github.com/jake-lunde/stage-times (git push to `main` triggers a production deploy)

Status: **launched, redesigned, instrumented, and Phase 1 of self-serve is proven.** CHBP 2026
wraps tonight (Sunday); after that the feeds are historical record and need nothing. The next
build is **Phase 2: the upload flow** — everything below points at it.

---

## What happened 2026-08-09

1. **Design refresh shipped** (owner-directed, live in production). Archivo (variable width,
   expanded caps for display) + Fragment Mono (fine detail), both self-hosted woff2 in
   `assets/fonts/` — zero third-party requests still holds. Landing got an Apple-style media
   card with the committed CHBP banner (`assets/festivals/<key>.webp`). Subscribe page: stage
   cards became a CSS scroll-snap carousel with deterministic procedural capsule art and
   per-day headliner previews; copy-link is a 44pt icon button; text buttons exist; everything
   tappable shrinks on press. **The skill was rewritten to match**
   (`.claude/skills/stage-times-design/`) — it is current and binding; the old "no webfont /
   no icons in buttons" rules are superseded in place.
2. **Analytics live.** Vercel Web Analytics snippet on both pages (plain-HTML pattern, stub
   before deferred script), one custom event: `subscribe` with `{festival, stage}`. Web
   Analytics was already enabled on the project (4 Aug). Tests pin the snippet into HTML and
   out of every `.ics`, both statically and in the live smoke test. **Caveat:** Vercel gates
   *custom events* to Pro/Enterprise — pageviews work on any plan; if `lunde-os` is Hobby the
   subscribe panel stays empty (the code is harmless either way).
3. **Phase 1 ingest CLI built and eval'd — the transcription question is answered.**
   `npm run ingest -- <image>` (branch `feat/ingest-cli`, **not yet merged**) transcribes a
   poster via Claude vision into festival YAML + a TRANSCRIPTION-style ambiguity log, reusing
   `src/schema.ts` for validation. The eval re-transcribed all three CHBP posters and diffed
   against the 79 hand-verified sets: **79/79 exact** (stage, artist, raw, start, end,
   end_inferred), 9/9 CLOSE-inferred ends flagged, 41 reviewer observations logged. Cost:
   **$0.74 for all three posters** (~25¢ each) on Opus. Artifacts:
   `stage-times-ingest` worktree, `_ref/ingest-eval/`.
4. **`build.ts` manifest gained `headliners`** per stage (the closer of each calendar day) —
   feeds.json consumers can rely on it.

## Housekeeping for the next session

- **Merge `feat/ingest-cli`.** It sits in the `../stage-times-ingest` worktree with one
  uncommitted edit to `src/ingest.ts` — review, commit, merge, then
  `git worktree remove ../stage-times-ingest`. The `../stage-times-analytics` worktree is
  merged and can be removed.
- **Vision calls need a real API key.** The eval fell back to the local `claude` CLI
  (`claude -p --model opus`), which bills the owner's *subscription session usage* — fine
  once, wrong for anything recurring. Phase 2's serverless function needs `ANTHROPIC_API_KEY`
  (Vercel env var). Also worth an eval rerun on a cheaper vision model against the same 79-set
  ground truth before wiring Phase 2's default — the eval harness makes that a one-liner.
- Known cosmetic: `webcal://` first hop is plain http → one-time "Insecure Connection" prompt
  on Apple devices. Deliberate; see 8 Aug handoff reasoning (`webcals://` is the alternative).
- Carry-over, all safe: artist casing is poster-uppercase; nine inferred CLOSE ends stand
  unless a real curfew surfaces (fix YAML → SEQUENCE bumps propagate); official schedule deep
  link unconfirmed.

---

## NEXT: Phase 2 — upload a screenshot, get a webcal, publish to the site

Owner's ask (2026-08-08): *"users can upload a screenshot and create a webcal and then those
are published to the site for ease of access for new users."* Phase 1 de-risked transcription;
what remains is the product surface and the publish pipeline.

### Working agreement (owner, 2026-08-09)

**Delegate non-taste builds to agents; taste work stays in the main session.** The upload and
review screens are *new design surfaces* — they are taste work. The serverless plumbing,
GitHub-API commit flow, rate limiting, and slug collision logic are not — delegate them.
Parallel agents get their own git worktrees and commit to branches; merge/push decisions stay
with the owner (or with explicit approval).

### Recommended architecture: git-backed ingest (unchanged, now half-built)

Don't build a database. The pipeline writes to the repo through a serverless endpoint:

```
upload (web) ──► transcribe (Phase 1 pipeline as a library, real API key)
             ──► validate (src/schema.ts)
             ──► review screen (uploader confirms against their own image)
             ──► commit YAML + state via GitHub API
             ──► Vercel auto-deploys (~60–90s; show it honestly: "being pressed…")
             ──► feed live at stagetimes.app/<slug>-<year>/<stage>.ics
```

Every existing gate keeps firing (75 tests run in `vercel-build`); determinism survives
(`publishedAt` stamped at commit time by the endpoint, never by the build); audit and rollback
are git. One vision call per upload ≈ $0.25.

### Trust tiers (make verification visible)

| Tier | Meaning | Where it shows |
|---|---|---|
| draft | transcribed, not yet confirmed by anyone | unlisted URL only, `X-WR-CALNAME` prefixed "DRAFT — " |
| uploader-verified | uploader confirmed against their image | live feed, listed nowhere yet |
| listed | owner approved for the public directory | homepage directory |

Publishing a feed ≠ listing it. Directory listing stays owner-curated — one owner-click per
festival, not a moderation queue.

### Phase 2 scope (independently shippable)

Public upload page (design system: one decision per screen — a single huge "Upload schedule"
button). Serverless: image → ingest pipeline → validation. Review screen: their image beside
the parsed schedule, per-set, inferred ends flagged, in the carousel/card idiom of the new
design. Confirm → commit → deploy → subscribe page at an unlisted URL. Needs:

- **Slug collision handling** — `<slug>-<year>` taken → error, ask for a suffix. Slugs are
  forever; never auto-mint variants.
- Image constraints (size/type), IP-based rate limiting (low), `uploaded_by` email field for
  takedowns/corrections.
- The Phase 1 CLI refactored into an importable library (it validates already; the CLI wrapper
  stays for local use and eval reruns).

Phase 3 (public directory: `listed: true` in curated state) and Phase 4 (ops hardening:
`blocked` state that empties a feed but never 404s a published slug, correction flow via
re-upload → diff → SEQUENCE bump) are unchanged from the 8 Aug handoff.

### Decisions that need the owner — collect BEFORE building Phase 2

1. **Who can publish?** Anonymous + rate limits, or email-gated? (Recommend: email field, no
   auth wall, revisit if abused.)
2. **Straight-to-main or PR-per-festival?** (Recommend: straight-to-main for feeds,
   curation only for listing.)
3. **URL namespace — PERMANENT:** flat `stagetimes.app/<slug>-<year>/` like CHBP, or a `/f/`
   prefix for user-submitted? Decide before the first user upload.
4. **Uploaded poster images:** store privately for audit (recommended — it's the verification
   evidence; never republish) or transcribe-and-discard?
5. **Transcription model + cost ceiling.** Opus is proven at 79/79 / ~25¢ per poster. Rerun
   the eval on a cheaper vision model; pick on evidence.

### What NOT to do

- No database until a phase demonstrably cannot ship without one.
- No transcription-editing UI in v1 — wrong reads get fixed by re-upload; the image is the
  source of truth.
- Never auto-list. Never delete a published slug. Never let the build read the wall clock.
- New screens come from the skill (`.claude/skills/stage-times-design/` — freshly rewritten),
  not from generic taste. The review screen's per-set rows are a list surface; check
  `screens.md` conventions first.
