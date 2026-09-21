# Stage Times — standing facts and the working agreement

This file holds what no other file does: where the project runs, how Jake wants the work
done, and the gotchas. **Ticket state does not live here.** What shipped, what is parked, and
what is next is in the jaique vault (`docs/agents/issue-tracker.md`): each ticket's note
carries a `## Runner` entry, and the effort page carries `**Now**` and `## Shipped`. The
git log says what changed. Do not add a per-ticket paragraph to this file; an agent editing
it is how the ticket 17 heading got overwritten on 21 Sep 2026.

**Repo:** `/Users/jake/Documents/github/stage-times`
**Production:** https://stagetimes.app — a push to `main` triggers a production deploy, so
`git log origin/main..main` is exactly what is not yet live
**Vercel project:** `stage-times` @ LUNDE OS (`prj_mbuC9M3JFa5BMrEajeneh0vtLeHJ`)
**GitHub:** https://github.com/jake-lunde/stage-times — also the alert channel (review pull
requests, change diffs, signals, the monthly look-ahead)
**Tracker:** the jaique vault — `Efforts/On/🎪 Stage Times (E).md` and the numbered tickets
in `Efforts/Notes/Stage Times/`; the effort board is
https://claude.ai/code/artifact/7729f50e-926a-484f-8d12-cbe7003b7275
**Vocabulary:** `CONTEXT.md`. **Decisions:** `docs/adr/` and the effort page's `## Rulings`.

## Working agreement (owner, 2026-08-09, still in force)

Delegate non-taste builds to agents in their own worktrees (the ticket runner, `/run-tickets`,
does this off the vault's frontier); taste work (new screens, copy, owner decisions) stays in
the main session and carries `lane: jake` on its ticket. Merge to `main` locally is fine;
**push decisions stay with Jake.** Verify work done by a different model before building on
it. New screens come from `.claude/skills/stage-times-design/` (load `references/copy.md`
before writing any string), not from generic taste.

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
- The GitHub Actions jobs (watch, look-ahead) exist only once `main` is pushed, and the
  watcher needs `ANTHROPIC_API_KEY` as a repository secret (the wizard sets it, or
  `gh secret set`).
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
