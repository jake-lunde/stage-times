# The default transcription model is Claude Sonnet 5, with Claude Opus 5 as the fallback

Transcription is the one non-deterministic step in the pipeline and the one that costs money per
source, so which model reads a poster is worth deciding on evidence rather than on the assumption
that the most expensive model is the most careful. The 79 hand-verified sets of CHBP 2026 are the
ground truth; the three posters in `_ref/set-screenshots/` are the sources; the score is how many
of the 79 sets a model reproduces on every compared field — stage, artist, printed string, start,
end, and the inferred-end flag.

First measured 2026-09-13; re-measured 2026-09-22 after the prompt gained a per-set `unsure` field
(the review's only flag, see the upload screens) and the guessed end for a stage's closer went to
90 minutes — a guessed end is no longer compared where both sides guessed, since it is the
pipeline's rule and not the model's reading. Two trials per model, over the API (never the local
`claude` CLI, which bills a subscription and picks its own model, so it can price nothing):

| Model | Exact | Inferred ends | $/source | $/edition (3 sources) |
|---|---|---|---|---|
| `claude-haiku-4-5-20251001` | — (two posters transcribed to the same date 2026-08-08 — check that each image is a distinct day) | — | $0.0097 | $0.0290 |
| `claude-sonnet-5` | 79 / 79 | 9 / 9 | $0.0564 | $0.1692 |
| `claude-opus-5` | 79 / 79 | 9 / 9 | $0.0801 | $0.2402 |

Claude Sonnet 5 was exact in both trials both times and costs about 30% less per source than
Claude Opus 5, which was also exact on 2026-09-22 (on 2026-09-13 it missed one set in one trial —
a duplicated `AFTERS` label inside the printed string of the Sunday Neumos afters billing,
cosmetic but a mismatch). Claude Haiku 4.5 failed both trials both times: in 2026-09-13 it
invented an empty second day on the Sunday poster, on 2026-09-22 it read two posters as the same
date; the transcription seam rejects both outright rather than silently publishing a hole. So
Sonnet 5 is the default. Opus 5 is not retired — it stays named as the fallback, transcribing
whenever a call to the default model fails. Neither model marked any CHBP line `unsure`, which is
the right answer on a clean poster.

The choice is configuration, not code: `config/vision-models.json` names the default, the fallback,
and the price of every model scored. The numbers behind the current setting are
`docs/evals/transcription-models.json`, and regenerating them is
`npm run ingest:eval -- --trials 2 --record <YYYY-MM-DD>`. Revisit when a new model appears or a
price changes; the decision rule is the cheapest model that stays exact across every trial, and it
lives in code as `recommendDefault` in `src/eval.ts` so the config and the evidence cannot drift
apart without a test failing.

Status: accepted, 2026-09-13; re-measured 2026-09-22, decision unchanged.
