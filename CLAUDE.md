# Stage Times

Set times, by stage. One iCalendar feed per festival stage at stagetimes.app.

## Read first

- `README.md` — the permanence contract. Feed URLs, stage ids, UID
  derivation, and artist normalization are frozen from first publish, and
  the build enforces it. Read it before touching `src/`, `data/`, or
  `state/`.
- `HANDOFF.md` — where the last session left things and what's next.
- `CONTEXT.md` — the glossary. Use its terms in every ticket, spec, test
  name, and page.
- `.claude/skills/stage-times-design/` — load before writing or changing
  any HTML, CSS, or copy.

## Agent skills

### Issue tracker

The jaique vault (`/Users/jake/jaique`): specs and `blocked-by:`-edged
ticket notes under `Efforts/Notes/Stage Times/`, statuses as triage roles.
See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context: glossary in root `CONTEXT.md`, ADRs in `docs/adr/`, and
the decision lanes (ADR vs vault ruling vs law vs memory). See
`docs/agents/domain.md`.
