/**
 * Ingest eval — NOT a unit test (needs the Anthropic API; `npm test` ignores it).
 *
 *   npm run ingest:eval                       # every model in the catalog
 *   npm run ingest:eval -- --models a,b       # just these
 *   npm run ingest:eval -- --trials 2         # repeat each model N times
 *   npm run ingest:eval -- --record 2026-09-13   # rewrite the committed record
 *
 * Runs the transcription pipeline on the three CHBP posters in
 * `_ref/set-screenshots/` once per model per trial and diffs each result
 * against the hand-verified `data/capitol-hill-block-party-2026.yaml` (79 sets,
 * nine of them inferred-end). The hand transcription is the ground truth; the
 * diff is the score; the rule for the default model is `recommendDefault` in
 * src/eval.ts — the cheapest model that stays exact in every trial. Trials
 * matter because this is the one nondeterministic step in the pipeline: one
 * good run is not evidence that a model holds.
 *
 * The API backend only. The local `claude` CLI bills a subscription and picks
 * its own model, so it can neither price a model nor prove which one answered.
 * A missing ANTHROPIC_API_KEY stops the run.
 *
 * Per-trial scratch output lands in `_ref/ingest-eval/<model>/t<trial>/`
 * (gitignored; the hand-verified source files are never touched):
 *   raw/<image>.json   raw model output, verbatim (reused on re-runs, so a
 *                      second run is free — delete them to re-transcribe)
 *   capitol-hill-block-party-2026.yaml
 *   TRANSCRIPTION.md
 *   REPORT.md          the per-model diff report
 * and the comparison across models in `_ref/ingest-eval/MODELS.md`.
 *
 * With `--record <YYYY-MM-DD>` the numbers are also written to the committed
 * `docs/evals/transcription-models.json`, which is what ADR-0002 and
 * `config/vision-models.json` are checked against. The date is an argument
 * because nothing in this repo reads the wall clock.
 *
 * Fields compared per set: stage, artist, raw, start, end, end_inferred.
 * `notes` are prose and judged by eye via TRANSCRIPTION.md, not diffed.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import {
  costUsdPerPoster,
  recommendDefault,
  renderComparison,
  renderModelReport,
  scoreTranscription,
  type EvalRecord,
  type EvalSet,
  type ModelResult,
  type PosterCost,
} from '../src/eval.js';
import { loadVisionConfig, visionModel } from '../src/models.js';
import { loadFestival, type SetEntry } from '../src/schema.js';
import { transcribe, type ModelOutput } from '../src/transcription.js';
import { requireSdkBackend, transcribeImage } from '../src/vision.js';
import { REPO_ROOT } from './helpers.js';

const POSTERS = [
  'CHBP+Daily+Schedule_FRIDAY.webp',
  'CHBP+Daily+Schedule_SATURDAY.webp',
  'CHBP+Daily+Schedule_SUNDAY.webp',
];
const POSTER_DIR = join(REPO_ROOT, '_ref', 'set-screenshots');
const OUT_DIR = join(REPO_ROOT, '_ref', 'ingest-eval');
const HAND_YAML = join(REPO_ROOT, 'data', 'capitol-hill-block-party-2026.yaml');
export const RECORD_PATH = join(REPO_ROOT, 'docs', 'evals', 'transcription-models.json');

/** The hand-verified sets, with `raw` read straight from the YAML text. */
function groundTruth(): EvalSet[] {
  const doc = loadFestival(HAND_YAML);
  const raws = (parseYaml(readFileSync(HAND_YAML, 'utf8')) as { sets: { raw?: string }[] }).sets.map(
    (s) => s.raw ?? '',
  );
  return doc.sets.map((s: SetEntry, i: number) => ({
    stage: s.stage,
    artist: s.artist,
    raw: raws[i] ?? '',
    start: s.start.raw,
    end: s.end.raw,
    end_inferred: s.end_inferred,
  }));
}

interface Args {
  models: string[] | null;
  trials: number;
  record: string | null;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { models: null, trials: 1, record: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]!;
    const next = (): string => {
      const v = argv[i + 1];
      if (v === undefined) {
        console.error(`${a} needs a value`);
        process.exit(2);
      }
      i += 1;
      return v;
    };
    if (a === '--models') args.models = next().split(',').map((m) => m.trim()).filter(Boolean);
    else if (a === '--trials') args.trials = Number(next());
    else if (a === '--record') args.record = next();
    else {
      console.error('usage: npm run ingest:eval -- [--models a,b] [--trials n] [--record YYYY-MM-DD]');
      process.exit(2);
    }
  }
  if (!Number.isInteger(args.trials) || args.trials < 1) {
    console.error('--trials takes a whole number of runs per model, 1 or more');
    process.exit(2);
  }
  if (args.record !== null && !/^\d{4}-\d{2}-\d{2}$/.test(args.record)) {
    console.error('--record takes the measurement date as YYYY-MM-DD');
    process.exit(2);
  }
  return args;
}

async function runModel(model: string, trial: number, hand: EvalSet[]): Promise<ModelResult> {
  const config = loadVisionConfig();
  const entry = visionModel(config, model);
  const backend = requireSdkBackend();
  const modelDir = join(OUT_DIR, model, `t${trial}`);
  mkdirSync(join(modelDir, 'raw'), { recursive: true });

  const outputs: ModelOutput[] = [];
  const posters: PosterCost[] = [];
  for (const poster of POSTERS) {
    const rawPath = join(modelDir, 'raw', `${poster}.json`);
    const costPath = join(modelDir, 'raw', `${poster}.cost.json`);
    if (existsSync(rawPath) && existsSync(costPath)) {
      outputs.push({ source: poster, output: readFileSync(rawPath, 'utf8') });
      posters.push(JSON.parse(readFileSync(costPath, 'utf8')) as PosterCost);
      console.error(`  replayed ${poster}`);
      continue;
    }
    console.error(`  transcribing ${poster} with ${model} …`);
    const started = Date.now();
    const vision = await transcribeImage(join(POSTER_DIR, poster), { backend, model, config });
    const cost: PosterCost = {
      source: poster,
      costUsd: vision.costUsd ?? 0,
      inputTokens: vision.inputTokens ?? 0,
      outputTokens: vision.outputTokens ?? 0,
    };
    writeFileSync(rawPath, vision.output.endsWith('\n') ? vision.output : vision.output + '\n');
    writeFileSync(costPath, JSON.stringify(cost, null, 2) + '\n');
    outputs.push({ source: poster, output: vision.output });
    posters.push(cost);
    console.error(
      `    done in ${((Date.now() - started) / 1000).toFixed(0)}s · $${cost.costUsd.toFixed(4)} · ${vision.model}`,
    );
  }

  const base: ModelResult = {
    model,
    label: entry.label,
    backend: 'sdk',
    structuredOutputs: entry.structuredOutputs,
    trial,
    exact: 0,
    total: hand.length,
    inferredFlagged: 0,
    inferredExpected: hand.filter((s) => s.end_inferred).length,
    mismatches: 0,
    missing: hand.length,
    extra: 0,
    generatedSets: 0,
    costUsdPerPoster: costUsdPerPoster(posters),
    costUsdTotal: posters.reduce((sum, p) => sum + p.costUsd, 0),
    posters,
  };

  // A reply the transcription seam rejects is a failed model, not a crashed
  // eval: record why and score it zero.
  let built;
  try {
    // Name, slug and timezone are human-supplied knowledge, same as they were
    // for the hand transcription — the eval scores set transcription.
    built = transcribe(outputs, {
      namespace: 'owner',
      name: 'Capitol Hill Block Party',
      slug: 'capitol-hill-block-party',
      timezone: 'America/Los_Angeles',
      timezoneAssumed: false,
    });
  } catch (err) {
    const failure = (err as Error).message.replace(/\s+/g, ' ').trim().slice(0, 240);
    console.error(`  ${model}: ${failure}`);
    writeFileSync(join(modelDir, 'REPORT.md'), `# ${entry.label}, trial ${trial}\n\nFailed: ${failure}\n`);
    return { ...base, failure };
  }

  writeFileSync(join(modelDir, 'capitol-hill-block-party-2026.yaml'), built.yaml);
  writeFileSync(join(modelDir, 'TRANSCRIPTION.md'), built.log);

  const score = scoreTranscription(
    hand,
    built.sets.map((s) => ({
      stage: s.stage,
      artist: s.artist,
      raw: s.raw,
      start: s.start,
      end: s.end,
      end_inferred: s.end_inferred,
    })),
  );
  const result: ModelResult = {
    ...base,
    exact: score.exact,
    inferredFlagged: score.generatedInferred,
    mismatches: score.mismatches.length,
    missing: score.missing.length,
    extra: score.extra.length,
    generatedSets: score.generatedCount,
  };
  writeFileSync(join(modelDir, 'REPORT.md'), renderModelReport(result, score));
  return result;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const config = loadVisionConfig();
  const models = args.models ?? Object.keys(config.models);
  const hand = groundTruth();
  mkdirSync(OUT_DIR, { recursive: true });

  const results: ModelResult[] = [];
  for (const model of models) {
    for (let trial = 1; trial <= args.trials; trial += 1) {
      console.error(`\n${model} · trial ${trial}`);
      const result = await runModel(model, trial, hand);
      results.push(result);
      console.error(
        `  ${result.failure ? 'FAILED' : `${result.exact}/${result.total} exact`} · $${result.costUsdPerPoster.toFixed(4)}/source`,
      );
    }
  }

  const record: EvalRecord = {
    groundTruth: {
      edition: 'data/capitol-hill-block-party-2026.yaml',
      sets: hand.length,
      inferredEnds: hand.filter((s) => s.end_inferred).length,
    },
    sources: POSTERS,
    trials: args.trials,
    measured: args.record ?? 'unrecorded',
    chosen: { default: config.default, fallback: config.fallback },
    pricingSource: config.pricingSource,
    results,
  };

  const table = renderComparison(record);
  const cheapestExact = recommendDefault(results);
  const lines = [
    '# Transcription model eval — CHBP 2026, 79 hand-verified sets',
    '',
    table,
    '',
    `${args.trials} trial${args.trials === 1 ? '' : 's'} per model; a model counts as exact only if every trial was.`,
    '',
    cheapestExact
      ? `Cheapest model that stays exact: \`${cheapestExact.model}\`.`
      : 'No model stayed exact — the proven model stays the default.',
    `Configured default: \`${config.default}\`; fallback: \`${config.fallback}\`.`,
    '',
  ];
  writeFileSync(join(OUT_DIR, 'MODELS.md'), lines.join('\n'));
  console.log('\n' + lines.join('\n'));

  if (args.record) {
    mkdirSync(join(REPO_ROOT, 'docs', 'evals'), { recursive: true });
    writeFileSync(RECORD_PATH, JSON.stringify(record, null, 2) + '\n');
    console.error(`wrote ${RECORD_PATH}`);
  } else {
    console.error('(no --record <YYYY-MM-DD>: the committed record was left alone)');
  }
  console.error(`wrote ${join(OUT_DIR, 'MODELS.md')}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.exit(1);
});
