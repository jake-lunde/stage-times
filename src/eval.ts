/**
 * Stage Times — scoring a machine transcription against a hand-verified one,
 * and picking the model on what the score says.
 *
 * The ground truth is `data/capitol-hill-block-party-2026.yaml`: 79 sets a
 * human checked against the three CHBP posters, nine of them with an end time
 * inferred from a printed CLOSE. A model's score is how many of those 79 sets
 * it reproduces exactly — stage, artist, printed string, start, end, and the
 * inferred-end flag, all six fields.
 *
 * The decision rule is one function, `recommendDefault`: the cheapest model
 * that stays exact. Everything in this module is pure — no files, no model, no
 * network, no clock — so both the scoring and the rule are unit-tested, and
 * `tests/ingest-eval.ts` is only the part that calls the API and writes files.
 */

import { normalizeArtist } from './schema.js';

/** One set, flattened to the fields the eval compares. */
export interface EvalSet {
  stage: string;
  artist: string;
  /** The printed line, exactly as the source shows it. */
  raw: string;
  start: string;
  end: string;
  end_inferred: boolean;
}

/** Stage is part of the match key; these are the fields a match must agree on. */
export const COMPARED_FIELDS = ['artist', 'raw', 'start', 'end', 'end_inferred'] as const;
export type ComparedField = (typeof COMPARED_FIELDS)[number];

export interface Mismatch {
  hand: EvalSet;
  generated: EvalSet;
  fields: ComparedField[];
}

export interface DayScore {
  day: string;
  exact: number;
  total: number;
}

export interface TranscriptionScore {
  /** Sets in the hand-verified edition. */
  total: number;
  /** Sets the machine reproduced on every compared field. */
  exact: number;
  mismatches: Mismatch[];
  /** Hand-verified sets with no machine counterpart. */
  missing: EvalSet[];
  /** Machine sets with no hand-verified counterpart. */
  extra: EvalSet[];
  generatedCount: number;
  /** Inferred-end sets: nine in the ground truth. */
  handInferred: number;
  generatedInferred: number;
  perDay: DayScore[];
}

/** Festival-day attribution: a post-midnight set belongs to the previous day. */
export function festivalDay(startIso: string): string {
  const hour = Number(startIso.slice(11, 13));
  if (hour >= 6) return startIso.slice(0, 10);
  const [y, m, d] = startIso.slice(0, 10).split('-').map(Number) as [number, number, number];
  const prev = new Date(Date.UTC(y, m - 1, d - 1));
  const p2 = (n: number): string => String(n).padStart(2, '0');
  return `${prev.getUTCFullYear()}-${p2(prev.getUTCMonth() + 1)}-${p2(prev.getUTCDate())}`;
}

function matchKey(set: EvalSet): string {
  return `${set.stage}\0${normalizeArtist(set.artist)}`;
}

/**
 * Score `generated` against the hand-verified `hand`.
 *
 * Sets are paired by stage and normalized artist — the same normalization the
 * UID uses, so a casing difference pairs but still fails the `artist` field
 * comparison. A set whose artist was misread pairs on stage and start time
 * instead, which keeps one bad read from cascading into a missing set and an
 * extra set.
 */
export function scoreTranscription(hand: EvalSet[], generated: EvalSet[]): TranscriptionScore {
  const byKey = new Map<string, EvalSet[]>();
  for (const set of generated) {
    const key = matchKey(set);
    const bucket = byKey.get(key);
    if (bucket) bucket.push(set);
    else byKey.set(key, [set]);
  }

  const matched = new Set<EvalSet>();
  const mismatches: Mismatch[] = [];
  const missing: EvalSet[] = [];
  const perDay = new Map<string, DayScore>();
  let exact = 0;

  for (const handSet of hand) {
    const day = festivalDay(handSet.start);
    const dayScore = perDay.get(day) ?? { day, exact: 0, total: 0 };
    dayScore.total += 1;
    perDay.set(day, dayScore);

    const candidate =
      (byKey.get(matchKey(handSet)) ?? []).find((g) => !matched.has(g)) ??
      generated.find((g) => !matched.has(g) && g.stage === handSet.stage && g.start === handSet.start);
    if (!candidate) {
      missing.push(handSet);
      continue;
    }
    matched.add(candidate);
    // A guessed end is the pipeline's rule, not the model's reading: where both
    // sides guessed, the end is not compared — the guess length may change
    // (60 → 90 for closers, 2026-09-22) without the reading getting worse.
    const fields = COMPARED_FIELDS.filter((f) => candidate[f] !== handSet[f] && !(f === 'end' && handSet.end_inferred && candidate.end_inferred));
    if (fields.length === 0) {
      exact += 1;
      dayScore.exact += 1;
    } else {
      mismatches.push({ hand: handSet, generated: candidate, fields });
    }
  }

  return {
    total: hand.length,
    exact,
    mismatches,
    missing,
    extra: generated.filter((g) => !matched.has(g)),
    generatedCount: generated.length,
    handInferred: hand.filter((s) => s.end_inferred).length,
    generatedInferred: generated.filter((s) => s.end_inferred).length,
    perDay: [...perDay.values()].sort((a, b) => a.day.localeCompare(b.day)),
  };
}

// ---------------------------------------------------------------------------
// The committed record — one run of the eval, per model
// ---------------------------------------------------------------------------

/** What one source image cost with one model. */
export interface PosterCost {
  source: string;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
}

export interface ModelResult {
  model: string;
  label: string;
  /** Always 'sdk': the eval prices the API, never the local CLI. */
  backend: 'sdk';
  structuredOutputs: boolean;
  /** 1-based trial number — transcription is not deterministic, so it repeats. */
  trial: number;
  /** Exact matches out of `total`. */
  exact: number;
  total: number;
  /** Inferred-end sets flagged, out of `inferredExpected`. */
  inferredFlagged: number;
  inferredExpected: number;
  mismatches: number;
  missing: number;
  extra: number;
  generatedSets: number;
  /** Mean USD per source image, measured from reported token usage. */
  costUsdPerPoster: number;
  costUsdTotal: number;
  posters: PosterCost[];
  /** Set when the model could not produce a readable transcription at all. */
  failure?: string;
}

export interface EvalRecord {
  groundTruth: { edition: string; sets: number; inferredEnds: number };
  sources: string[];
  /** How many times each model transcribed every source. */
  trials: number;
  /** The date the numbers were measured, supplied by the runner (no clock reads). */
  measured: string;
  chosen: { default: string; fallback: string };
  pricingSource: string;
  results: ModelResult[];
}

/** Mean cost per source image, or 0 when nothing was measured. */
export function costUsdPerPoster(posters: PosterCost[]): number {
  if (posters.length === 0) return 0;
  return posters.reduce((sum, p) => sum + p.costUsd, 0) / posters.length;
}

/** Did this trial reproduce every hand-verified set exactly? */
export function isExact(result: ModelResult): boolean {
  return result.failure === undefined && result.total > 0 && result.exact === result.total;
}

/** Every trial of one model, collapsed to what the decision reads. */
export interface ModelSummary {
  model: string;
  label: string;
  trials: number;
  /** Exact in EVERY trial. One good run does not make a model exact. */
  exact: boolean;
  /** Worst and best exact-match count across trials, out of `total`. */
  worstExact: number;
  bestExact: number;
  total: number;
  /** Worst inferred-end count across trials, out of `inferredExpected`. */
  worstInferredFlagged: number;
  inferredExpected: number;
  /** Mean USD per source image across every trial. */
  costUsdPerPoster: number;
  costUsdPerEdition: number;
  /** The trial failures, if any — a model that could not be read at all. */
  failures: string[];
}

/** Collapse per-trial results to one row per model, in first-seen order. */
export function summarizeByModel(results: ModelResult[]): ModelSummary[] {
  const byModel = new Map<string, ModelResult[]>();
  for (const r of results) {
    const bucket = byModel.get(r.model);
    if (bucket) bucket.push(r);
    else byModel.set(r.model, [r]);
  }
  return [...byModel.entries()].map(([model, trials]) => {
    const first = trials[0]!;
    const failures = trials.filter((t) => t.failure !== undefined).map((t) => t.failure!);
    return {
      model,
      label: first.label,
      trials: trials.length,
      exact: trials.every(isExact),
      worstExact: Math.min(...trials.map((t) => t.exact)),
      bestExact: Math.max(...trials.map((t) => t.exact)),
      total: first.total,
      worstInferredFlagged: Math.min(...trials.map((t) => t.inferredFlagged)),
      inferredExpected: first.inferredExpected,
      costUsdPerPoster: trials.reduce((sum, t) => sum + t.costUsdPerPoster, 0) / trials.length,
      costUsdPerEdition: trials.reduce((sum, t) => sum + t.costUsdTotal, 0) / trials.length,
      failures,
    };
  });
}

/**
 * The decision rule: the cheapest model that stays exact in every trial, by
 * measured cost.
 *
 * Returns null when nothing stayed exact — in which case the proven model
 * stays the default and the config is not touched.
 */
export function recommendDefault(results: ModelResult[]): ModelSummary | null {
  const exact = summarizeByModel(results).filter((m) => m.exact);
  if (exact.length === 0) return null;
  return exact.reduce((cheapest, candidate) =>
    candidate.costUsdPerPoster < cheapest.costUsdPerPoster ? candidate : cheapest,
  );
}

const usd = (n: number): string => `$${n.toFixed(4)}`;

/** The per-model comparison table, cheapest first. */
export function renderComparison(record: EvalRecord): string {
  const rows = summarizeByModel(record.results).sort((a, b) => a.costUsdPerPoster - b.costUsdPerPoster);
  const lines: string[] = [];
  lines.push(`| Model | Exact | Inferred ends | $/source | $/edition (${record.sources.length} sources) |`);
  lines.push(`|---|---|---|---|---|`);
  for (const r of rows) {
    const range = r.worstExact === r.bestExact ? `${r.worstExact}` : `${r.worstExact}–${r.bestExact}`;
    const exact = r.failures.length > 0 ? `— (${r.failures[0]})` : `${range} / ${r.total}`;
    const inferred = r.failures.length > 0 ? '—' : `${r.worstInferredFlagged} / ${r.inferredExpected}`;
    lines.push(
      `| \`${r.model}\` | ${exact} | ${inferred} | ${usd(r.costUsdPerPoster)} | ${usd(r.costUsdPerEdition)} |`,
    );
  }
  return lines.join('\n');
}

/** The scratch report for one model — the detail a human reads after a run. */
export function renderModelReport(result: ModelResult, score: TranscriptionScore): string {
  const R: string[] = [];
  R.push(
    `# ${result.label} (\`${result.model}\`), trial ${result.trial} — machine transcription vs hand-verified CHBP 2026`,
  );
  R.push('');
  R.push(`Backend: ${result.backend}, structured outputs: ${result.structuredOutputs ? 'on' : 'off'}.`);
  R.push('');
  R.push('## Score');
  R.push('');
  R.push(`- Exact matches (stage+artist+raw+start+end+end_inferred): **${score.exact} / ${score.total}**`);
  R.push(`- Field mismatches: ${score.mismatches.length} · missing: ${score.missing.length} · extra: ${score.extra.length}`);
  R.push(`- Generated set count: ${score.generatedCount}`);
  R.push(`- Inferred (CLOSE) ends: hand ${score.handInferred}, machine ${score.generatedInferred}`);
  R.push(`- Cost: ${usd(result.costUsdPerPoster)} per source, ${usd(result.costUsdTotal)} for the edition`);
  R.push('');
  R.push('Per festival day (post-midnight sets attributed to the poster day):');
  R.push('');
  for (const day of score.perDay) R.push(`- ${day.day}: ${day.exact} / ${day.total} exact`);
  if (score.mismatches.length > 0) {
    R.push('');
    R.push('## Mismatches');
    R.push('');
    for (const m of score.mismatches) {
      R.push(
        `- ${m.hand.stage} · ${m.hand.artist} · ${m.hand.start}:` +
          m.fields
            .map((f) => `\n    ${f}: hand=${JSON.stringify(m.hand[f])} gen=${JSON.stringify(m.generated[f])}`)
            .join(''),
      );
    }
  }
  if (score.missing.length > 0) {
    R.push('');
    R.push('## Missing from the machine transcription');
    R.push('');
    for (const s of score.missing) R.push(`- MISSING: ${s.stage} · ${s.artist} · ${s.start}`);
  }
  if (score.extra.length > 0) {
    R.push('');
    R.push('## Extra sets not in the hand transcription');
    R.push('');
    for (const s of score.extra) R.push(`- EXTRA: ${s.stage} · ${s.artist} · ${s.start}`);
  }
  R.push('');
  return R.join('\n');
}
