# Stage Times — standing facts and the working agreement

This file holds what no other file does: where the project runs, how Jake wants the work
done, and the gotchas. **Ticket state does not live here.** What shipped, what is parked, and
what is next is in the jaique vault (`docs/agents/issue-tracker.md`): each ticket's note
carries its `status:`, and the effort page carries `**Now**` and `## Shipped`. The
git log says what changed. Do not add a per-ticket paragraph to this file; an agent editing
it is how the ticket 17 heading got overwritten on 21 Sep 2026.

**Repo:** `/Users/jake/code/stage-times`
**Production:** https://stagetimes.app — a push to `main` triggers a production deploy, so
`git log origin/main..main` is exactly what is not yet live
**Vercel project:** `stage-times` @ LUNDE OS (`prj_mbuC9M3JFa5BMrEajeneh0vtLeHJ`)
**GitHub:** https://github.com/jake-lunde/stage-times — issues are where "Wrong time? Tell me"
lands. The watcher's review pull requests and the monthly look-ahead no longer come (Gotchas)
**Adding a festival:** by hand — the data YAML, its art, `listed: true`, build, push (`README.md`,
"Adding next year"). One commit per festival
**Tracker:** the jaique vault — `Efforts/On/🎪 Stage Times (E).md` and the numbered tickets
in `Efforts/Notes/Stage Times/`; the effort board is
https://claude.ai/code/artifact/7729f50e-926a-484f-8d12-cbe7003b7275
**Vocabulary:** `CONTEXT.md`. **Decisions:** `docs/adr/` and the effort page's `## Rulings`.

## Working agreement (owner, 2026-08-09; builds in the session since 2026-09-26)

Build one ticket at a time in the session, with one reviewer on a different model checking it
before Jake looks (`docs/agents/issue-tracker.md`, "Building a ticket"). Taste work (new
screens, copy, owner decisions) carries `lane: jake` and is worked with Jake, never alone.
Merge to `main` locally is fine.
Verify work done by a different model before building on it. New screens come from
`.claude/skills/stage-times-design/` (load `references/copy.md` before writing any string),
not from generic taste.

How to work with Jake (plain words first, ask before every push) lives in `~/.claude/CLAUDE.md`,
not here.

## What NOT to do

- No database until a phase demonstrably cannot ship without one.
- Never auto-list. Never delete a published slug. Never let the build read the wall clock.
- Never change `normalizeArtist`, UID derivation, `UID_DOMAIN`, a stage `id`, or an edition's
  `namespace` after first publish (the permanence contract, `README.md`).
- Don't put a feed URL, a repo path, or the word "we" on a page.

## Gotchas

- `npx serve` (the `.claude/launch.json` preview) 404s nested `/fan/<key>/` paths; Vercel and
  the build are fine. Preview fan editions another way or accept the quirk.
- A bare `assert.ok(x)` with no message costs about three minutes on failure under `tsx`
  while Node re-parses the source for the message. Give assertions messages.
- The GitHub Actions jobs, Watch (hourly) and Look-ahead (monthly), are **disabled** (owner,
  2026-09-23; `gh workflow list` shows `disabled_manually`). The watcher spent API tokens,
  committed to `main` for festivals already added by hand, and blocked a push; five festivals
  don't need it. The workflow files and `src/watcher.ts` are still here. Expect no watch
  commits, review pull requests, or look-ahead issues. Turning one back on is Jake's call:
  `gh workflow enable Watch`.
- `webcal://` first hop is plain http → one-time "Insecure Connection" prompt on Apple
  devices. Deliberate.

## Housekeeping

- Merged branches that can be deleted: `claude/ticket-06-homepage-shelf`, `docs/agent-setup`,
  `feat/analytics`, `feat/design-refresh`, `feat/ingest-cli`, `feat/editions-state`,
  `feat/ingest-library` (the last two still have worktrees under `.claude/worktrees/`).
- Agent worktrees under `.claude/worktrees/` are gitignored; `git worktree prune` after
  removing the directories.
- Carry-over: nine inferred CLOSE ends stand unless a real curfew surfaces; official schedule
  deep link unconfirmed.
