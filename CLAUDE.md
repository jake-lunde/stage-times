# Stage Times

Set times, by stage. One iCalendar feed per festival stage at stagetimes.app.

This file is the rules for this repo. How to work with Jake (plain words first, ask before every
push) is in `~/.claude/CLAUDE.md`. What is being worked on lives in the vault, never here.

## Read first

- `README.md`, "The permanence contract", before touching `src/`, `data/`, or `state/`. Feed
  URLs, stage ids, UID derivation, and artist normalization are frozen from first publish, and
  the build enforces it.
- `CONTEXT.md` — the glossary. Use its terms in every ticket, spec, test name, and page.
- `.claude/skills/stage-times-design/` — load before writing or changing any HTML, CSS, or copy,
  and its `references/copy.md` before writing any string.

## Where it runs

- **Production:** https://stagetimes.app. A push to `main` deploys, so `git log origin/main..main`
  is exactly what is not live yet.
- **Vercel:** project `stage-times` @ LUNDE OS (`prj_mbuC9M3JFa5BMrEajeneh0vtLeHJ`).
- **GitHub:** https://github.com/jake-lunde/stage-times. Issues are where "Wrong time? Tell me"
  lands.
- **Adding a festival:** by hand. The data YAML, its art, `listed: true`, build, push (README,
  "Adding next year"). One commit per festival.

## How the work is done

- **Tickets:** the jaique vault, `Efforts/On/🎪 Stage Times (E).md` and the numbered notes in
  `Efforts/Notes/Stage Times/`. Board: https://claude.ai/code/artifact/7729f50e-926a-484f-8d12-cbe7003b7275
- **Building:** one ticket at a time in the session, with one reviewer on a different model
  checking it before Jake looks (`docs/agents/issue-tracker.md`, "Building a ticket").
- **Taste work** (new screens, copy, owner decisions) carries `lane: jake` and is worked with
  Jake, never alone.
- **Merging** to `main` locally is fine. Pushing follows `~/.claude/CLAUDE.md`.
- **Decisions:** technical ones in `docs/adr/`, Jake's calls in the effort page's `## Rulings`.

## Never

- No database until a phase demonstrably cannot ship without one.
- Never auto-list. Never delete a published slug. Never let the build read the wall clock.
- Never change `normalizeArtist`, UID derivation, `UID_DOMAIN`, a stage `id`, or an edition's
  `namespace` after first publish.
- Don't put a feed URL, a repo path, or the word "we" on a page.

## Gotchas

- `npx serve` (the `.claude/launch.json` preview) 404s nested `/fan/<key>/` paths; Vercel and the
  build are fine.
- A bare `assert.ok(x)` with no message costs about three minutes on failure under `tsx` while
  Node re-parses the source. Give assertions messages.
- `webcal://` first hop is plain http, so Apple devices show a one-time "Insecure Connection"
  prompt. Deliberate.

## Agent skills

### Issue tracker

The jaique vault (`/Users/jake/jaique`): specs and `blocked-by:`-edged ticket notes under
`Efforts/Notes/Stage Times/`, statuses as triage roles. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context: glossary in root `CONTEXT.md`, ADRs in `docs/adr/`, and where each kind of
decision goes. See `docs/agents/domain.md`.
