# Stage Times — session handoff

**Date:** 8 August 2026 (evening — supersedes the morning handoff)
**Repo:** `/Users/jake/Documents/github/stage-times`
**Production:** https://stagetimes.app — **LIVE**
**Vercel project:** `stage-times` @ LUNDE OS (`prj_mbuC9M3JFa5BMrEajeneh0vtLeHJ`)
**GitHub:** https://github.com/jake-lunde/stage-times (git push to `main` triggers a production deploy)

Status: **launched.** CHBP 2026 is in production, the owner is subscribed on his own phone, and
the smoke test passes 5/5 against the apex. The URL contract is now real: every slug in
`state/published.json` is frozen forever.

---

## What happened since the morning handoff

1. **Friday transcribed** from `_ref/set-screenshots/CHBP+Daily+Schedule_FRIDAY.webp` — 26 sets,
   bringing the total to **79 across three days**. Saturday/Sunday were re-checked against the
   cleaner official images and matched exactly.
2. **All nine `CLOSE` end times resolved by fallback**: no published curfew or club close time
   exists anywhere findable (official FAQ has gate times only; EverOut/CHS/DMNW have nothing).
   Owner's rule, applied: start + 60 min, `end_inferred: true`, and the event description now
   says plainly *"assumed to be one hour after the start"* (the old caveat text falsely claimed
   inference from the next set — fixed, goldens regenerated).
3. **`verified: true`** — publish authorized by the owner 2026-08-08. `publishedAt` bumped to
   `20260808T211500Z`.
4. **Domain finished.** The morning mystery resolved: DNS was fine; the domain pair was attached
   with **www as primary**. Flipped via the Vercel API (PATCH project-domains — order matters:
   clear the apex redirect first, then set `www → apex 308`, because Vercel refuses redirect
   chains). Canonical host is now the bare apex, as the webcal contract requires.
5. **Deployed to production** via `npx vercel deploy --prod --scope lunde-os`. Test gates ran in
   Vercel's build. Subscription confirmed working end-to-end on the owner's phone.

Known cosmetic: the `webcal://` first hop is plain http, so Apple shows a one-time "Insecure
Connection" prompt before following the 308 to https. If it grates, switch the subscribe buttons
in `src/pages.ts` (~line 300) to `webcals://` — decide deliberately; `webcal://` has wider
client recognition.

---

## Small carry-over items (all safe, none urgent)

- **Artist casing** is poster-uppercase throughout. Fix against the official lineup page
  whenever; UIDs lowercase before hashing, so nobody's event gets orphaned.
- **If a real curfew ever surfaces**, correct the nine inferred ends in the YAML and rebuild —
  SEQUENCE bumps push the fix to every subscriber. (Bump `publishedAt` when you do.)
- **Official schedule deep link** still unconfirmed; event descriptions link the homepage.
- After the festival ends (Sunday night), nothing needs doing — feeds are historical record.

---

## NEXT: self-serve pipeline — upload a screenshot, get a webcal, publish to the site

Owner's ask (2026-08-08): *"users can upload a screenshot and create a webcal and then those
are published to the site for ease of access for new users."*

### The core tension to resolve first

Everything trustworthy about this codebase comes from two properties the self-serve idea
threatens:

1. **The human verification gate.** Ingest (image → YAML) is the one non-deterministic step. For
   CHBP the owner was the human. For self-serve, **the uploader must become the verifier of
   their own festival** — they review the transcription against their image and confirm. That's
   a weaker guarantee than owner review, so it must be a visible *tier*, not a silent
   equivalence.
2. **Committed state + deterministic build.** `state/published.json` and `state/sequences.json`
   live in git; the build never reads a clock; goldens pin bytes. A dynamic pipeline must not
   quietly abandon this.

### Recommended architecture: git-backed ingest (keep the static core)

Don't build a database. Make the pipeline **write to the repo** through a serverless endpoint:

```
upload (web) ──► transcribe (Claude vision, serverless fn)
             ──► validate (reuse src/schema.ts — it's already a library)
             ──► review screen (uploader confirms against their own image)
             ──► commit YAML + state to git via GitHub API, on a branch or straight to main
             ──► Vercel auto-deploys (git integration already active)
             ──► feed live at stagetimes.app/<slug>-<year>/<stage>.ics
```

Why this shape wins:
- **Every existing gate keeps firing** — the 69 tests run on every deploy via `vercel-build`.
- **Determinism survives** — the build still reads only committed files; `publishedAt` is
  stamped at commit time by the endpoint, not by the build.
- **Audit + rollback for free** — every published festival is a commit with the source image
  hash in the message. A bad publish is `git revert`.
- Costs: one Claude vision call per upload (~cents), zero infra beyond Vercel functions.
- Accepted tradeoff: ~60–90 s from "confirm" to live feed (a deploy). Show it honestly in the
  UI ("Your calendar is being pressed…"). If that's ever unacceptable, revisit — but do not
  start with a database for a latency complaint nobody has made yet.

### Trust tiers (make verification visible)

| Tier | Meaning | Where it shows |
|---|---|---|
| draft | transcribed, not yet confirmed by anyone | unlisted URL only, `X-WR-CALNAME` prefixed "DRAFT — " |
| uploader-verified | uploader confirmed against their image | live feed, listed nowhere yet |
| listed | owner approved for the public directory | homepage directory |

Publishing a feed ≠ listing it on the site. **Directory listing stays owner-curated at first** —
that's the moderation model, and it's one owner-click per festival, not a moderation queue to
build.

### Phases (each independently shippable)

**Phase 1 — internal CLI (de-risk transcription).** `npm run ingest -- <image>` → Claude vision
→ YAML + TRANSCRIPTION-style ambiguity log. This automates exactly what was done by hand for
CHBP, with the now-proven rules (raw strings preserved, `CLOSE` → +60 + caveat, post-midnight
date shifting, uppercase-casing disclaimer, duplicate-UID hard fail). Run it on the three CHBP
posters and diff against the hand transcription — **that's the eval, and it's already built.**
No product surface, pure leverage, do this first.

**Phase 2 — upload → draft feed.** Public upload page (design system: one decision per screen —
a single huge "Upload schedule" button). Serverless: image → Phase 1 pipeline → validation. The
uploader lands on a review screen: their image beside the parsed schedule, per-set, with
inferred ends flagged. Confirm → commit → deploy → subscribe page at an unlisted URL they can
share. Needs: slug collision handling (`<slug>-<year>` already taken → error, ask them to pick
a suffix; slugs are forever, so never auto-mint variants of an existing one), image constraints
(size/type), rate limiting (IP-based, low — this is not a growth product yet), and an
`uploaded_by` email field for takedowns/corrections (unauthenticated otherwise).

**Phase 3 — public directory.** Homepage lists **listed**-tier festivals. Owner approves via a
one-line change (a `listed: true` in the YAML, or a curated list file) — a git commit, same as
everything else. Draft/unlisted feeds keep working regardless.

**Phase 4 — ops hardening.** Only what reality demands: abuse response (a `blocked` state that
empties a feed but keeps the URL serving — never 404 a published slug), correction flow for
uploaders ("my times changed" → re-upload → diff → SEQUENCE bump), maybe draft expiry.

### Decisions that need the owner (collect before building Phase 2)

1. **Who can publish?** Anyone anonymous with rate limits, or email-gated? (Recommend: email
   field, no auth wall, revisit if abused.)
2. **Straight-to-main or PR-per-festival?** PRs give owner review before *any* URL exists but
   add hours of latency; straight-to-main + unlisted-until-approved gives instant feeds with
   curation only on discovery. (Recommend: straight-to-main for feeds, curation for listing.)
3. **Namespace:** flat `stagetimes.app/<slug>-<year>/` like CHBP, or a `/f/` prefix for
   user-submitted? Flat is prettier; a prefix would let the owner's hand-curated festivals stay
   visually distinct. This is a URL-contract decision — **permanent** — decide before the first
   user upload, not after.
4. **Copyright posture** for uploaded poster images: transcribe-and-discard, or store the image?
   (Recommend: store privately for audit — it's the verification evidence — never republish it.)
5. **Cost ceiling** for transcription calls, and which model (a vision-capable small model may
   be fine; the CHBP eval from Phase 1 answers this empirically).

### What NOT to do

- No database until a phase demonstrably cannot ship without one.
- No editing UI for transcriptions in v1 — wrong reads get fixed by re-upload, keeping "the
  image is the source of truth."
- Never auto-list. Never delete a published slug. Never let the build read the wall clock.

---

## Task: analytics (owner approved 2026-08-08)

Goal: answer *"is anyone finding this?"* and *"are they subscribing?"* — aggregate only,
cookieless, nothing stored about individuals. No per-subscriber URLs, ever — one canonical URL
per feed is a design invariant, and tokenized URLs are the creepy version of this feature.

1. **Pages:** enable Vercel Web Analytics on the project and add its snippet to the rendered
   HTML (`src/pages.ts` — pages are static, so use the plain `/_vercel/insights/script.js`
   script tag, not the React package). Track one custom event: subscribe-button taps, with
   `{festival, stage}` as properties. That tap is the best available "tried to subscribe"
   signal; the calendar app takes over after it.
2. **Feeds:** calendar clients don't run JS, so feed polls are invisible to Web Analytics.
   Read them from Vercel's request logs / observability (short retention). Only if history
   proves wanted: add a log drain (e.g. Axiom free tier) — do not build anything custom first.
3. **Interpretation notes** (so future sessions don't over-promise): Google Calendar fetches
   server-side — one poll may represent any number of subscribers. Apple devices poll directly
   (`REFRESH-INTERVAL` PT12H ⇒ ~2 polls/device/day), but rotating mobile IPs and iCloud Private
   Relay make unique-IP counts an estimate, not a census. 200-vs-304 ratio shows how many
   subscribers are on current bytes; polls stopping is the only churn signal that exists.
4. Keep the smoke test honest: the analytics script must appear on HTML pages only — never in
   `.ics` responses.

---

## Design system

`.claude/skills/stage-times-design/` — load before touching any HTML/CSS/copy. The upload and
review screens are new surfaces; they must come from the skill, not from generic taste. Review
screen note: per-set confirmation rows are a table-like surface — check `screens.md` for the
list-row conventions before inventing one.
