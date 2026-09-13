/**
 * The transcription-model choice, and the evidence behind it.
 *
 * Two halves. First the scoring rules in src/eval.ts — how a machine
 * transcription is compared to a hand-verified one, and the rule that picks the
 * default model from the scores. Those are pure and tested against small
 * fixtures. Second the committed record of the run that actually happened
 * (`docs/evals/transcription-models.json`), checked for the things that make it
 * evidence rather than a claim: the same three sources, the API backend, at
 * least two models cheaper than the proven one, and a configured default that
 * is exactly what the decision rule picks from those numbers.
 *
 * Nothing here calls a model or needs an API key. Re-running the eval is
 * `npm run ingest:eval -- --trials 2 --record <YYYY-MM-DD>`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  costUsdPerPoster,
  isExact,
  recommendDefault,
  renderComparison,
  scoreTranscription,
  summarizeByModel,
  type EvalRecord,
  type EvalSet,
  type ModelResult,
} from '../src/eval.js';
import { loadVisionConfig, visionModel } from '../src/models.js';
import { requireSdkBackend } from '../src/vision.js';
import { TranscribeError } from '../src/transcribe.js';
import { REPO_ROOT } from './helpers.js';

const RECORD_PATH = join(REPO_ROOT, 'docs', 'evals', 'transcription-models.json');
const ADR_PATH = join(REPO_ROOT, 'docs', 'adr', '0002-transcription-model.md');
const record = JSON.parse(readFileSync(RECORD_PATH, 'utf8')) as EvalRecord;
const config = loadVisionConfig();

// ---------------------------------------------------------------------------
// Scoring rules
// ---------------------------------------------------------------------------

function set(overrides: Partial<EvalSet> = {}): EvalSet {
  return {
    stage: 'main',
    artist: 'WET LEG',
    raw: 'WET LEG / 8:40-CLOSE',
    start: '2026-08-09T20:40:00',
    end: '2026-08-09T21:40:00',
    end_inferred: true,
    ...overrides,
  };
}

test('a set matching on every compared field scores exact', () => {
  const score = scoreTranscription([set()], [set()]);
  assert.equal(score.exact, 1);
  assert.equal(score.total, 1);
  assert.equal(score.mismatches.length, 0);
  assert.equal(score.missing.length, 0);
  assert.equal(score.extra.length, 0);
});

test('a set that differs on one field is a mismatch, and the field is named', () => {
  const score = scoreTranscription([set()], [set({ raw: 'WET LEG / 8:40 - CLOSE' })]);
  assert.equal(score.exact, 0);
  assert.deepEqual(score.mismatches[0]?.fields, ['raw'], 'only the printed string differs');
});

test('a misread artist still pairs by stage and start time rather than counting twice', () => {
  const score = scoreTranscription([set()], [set({ artist: 'WETLEG' })]);
  assert.equal(score.missing.length, 0, 'the set was found');
  assert.equal(score.extra.length, 0, 'and not also counted as an extra');
  assert.deepEqual(score.mismatches[0]?.fields, ['artist']);
});

test('a set the machine never produced is missing; one it invented is extra', () => {
  const hand = [set(), set({ stage: 'neumos', artist: 'PARCELS', start: '2026-08-09T19:00:00' })];
  const score = scoreTranscription(hand, [set(), set({ stage: 'barboza', artist: 'GHOST', start: '2026-08-09T15:00:00' })]);
  assert.equal(score.missing.length, 1);
  assert.equal(score.missing[0]?.artist, 'PARCELS');
  assert.equal(score.extra.length, 1);
  assert.equal(score.extra[0]?.artist, 'GHOST');
  assert.equal(score.exact, 1);
});

test('inferred-end sets are counted on both sides, and per festival day', () => {
  const hand = [set(), set({ artist: 'PARCELS', start: '2026-08-09T19:00:00', end_inferred: false })];
  const score = scoreTranscription(hand, hand.map((s) => ({ ...s })));
  assert.equal(score.handInferred, 1);
  assert.equal(score.generatedInferred, 1);
  assert.deepEqual(score.perDay, [{ day: '2026-08-09', exact: 2, total: 2 }]);
});

test('a set after midnight is scored under the day it was printed under', () => {
  const late = set({ artist: 'DJ100PROOF', start: '2026-08-10T00:30:00', end: '2026-08-10T01:30:00' });
  const score = scoreTranscription([late], [late]);
  assert.deepEqual(score.perDay, [{ day: '2026-08-09', exact: 1, total: 1 }], 'attributed to the poster day');
});

// ---------------------------------------------------------------------------
// The decision rule
// ---------------------------------------------------------------------------

function result(overrides: Partial<ModelResult>): ModelResult {
  return {
    model: 'claude-test',
    label: 'Test',
    backend: 'sdk',
    structuredOutputs: true,
    trial: 1,
    exact: 79,
    total: 79,
    inferredFlagged: 9,
    inferredExpected: 9,
    mismatches: 0,
    missing: 0,
    extra: 0,
    generatedSets: 79,
    costUsdPerPoster: 0.05,
    costUsdTotal: 0.15,
    posters: [],
    ...overrides,
  };
}

test('the recommended default is the cheapest model that stays exact', () => {
  const picked = recommendDefault([
    result({ model: 'dear', costUsdPerPoster: 0.09 }),
    result({ model: 'cheap', costUsdPerPoster: 0.01, exact: 70 }),
    result({ model: 'middle', costUsdPerPoster: 0.05 }),
  ]);
  assert.equal(picked?.model, 'middle', 'cheaper but inexact does not win');
});

test('a model that is exact in one trial and not the next is not exact', () => {
  const picked = recommendDefault([
    result({ model: 'flaky', trial: 1, costUsdPerPoster: 0.01 }),
    result({ model: 'flaky', trial: 2, exact: 78, costUsdPerPoster: 0.01 }),
    result({ model: 'steady', trial: 1, costUsdPerPoster: 0.05 }),
    result({ model: 'steady', trial: 2, costUsdPerPoster: 0.05 }),
  ]);
  assert.equal(picked?.model, 'steady');
  const flaky = summarizeByModel([result({ model: 'flaky' }), result({ model: 'flaky', trial: 2, exact: 78 })])[0];
  assert.equal(flaky?.exact, false);
  assert.equal(flaky?.worstExact, 78);
  assert.equal(flaky?.bestExact, 79);
});

test('a model whose output cannot be read at all is never recommended', () => {
  assert.equal(isExact(result({ failure: 'bad transcription shape', exact: 0 })), false);
  const picked = recommendDefault([
    result({ model: 'broken', costUsdPerPoster: 0.001, exact: 0, failure: 'bad transcription shape' }),
    result({ model: 'works', costUsdPerPoster: 0.07 }),
  ]);
  assert.equal(picked?.model, 'works');
});

test('when nothing stays exact the rule recommends nothing, leaving the proven model in place', () => {
  assert.equal(recommendDefault([result({ exact: 78 })]), null);
});

test('cost per source is the mean over the sources transcribed', () => {
  assert.equal(
    costUsdPerPoster([
      { source: 'a', costUsd: 0.02, inputTokens: 1, outputTokens: 1 },
      { source: 'b', costUsd: 0.04, inputTokens: 1, outputTokens: 1 },
    ]),
    0.03,
  );
  assert.equal(costUsdPerPoster([]), 0);
});

// ---------------------------------------------------------------------------
// The committed record — the run that actually happened
// ---------------------------------------------------------------------------

test('the eval scored the proven model and at least two cheaper vision models', () => {
  const scored = [...new Set(record.results.map((r) => r.model))];
  assert.ok(scored.includes(config.fallback), `the proven model ${config.fallback} was scored`);
  const provenPrice = visionModel(config, config.fallback).inputUsdPerMTok;
  const cheaper = scored.filter((m) => visionModel(config, m).inputUsdPerMTok < provenPrice);
  assert.ok(
    cheaper.length >= 2,
    `at least two cheaper models were scored (got ${cheaper.length}: ${cheaper.join(', ')})`,
  );
});

test('every model read the same three sources, over the API and never the local CLI', () => {
  assert.equal(record.sources.length, 3);
  for (const r of record.results) {
    assert.equal(r.backend, 'sdk', `${r.model} was measured over the API`);
    assert.equal(
      r.posters.length,
      record.sources.length,
      `${r.model} trial ${r.trial} read every source`,
    );
    for (const [i, poster] of r.posters.entries()) {
      assert.equal(poster.source, record.sources[i], 'the same sources, in the same order');
    }
  }
  const runner = readFileSync(join(REPO_ROOT, 'tests', 'ingest-eval.ts'), 'utf8');
  assert.equal(/\bpickBackend\b/.test(runner), false, 'the eval never falls back to the CLI backend');
  assert.ok(/requireSdkBackend\(\)/.test(runner), 'the eval demands the API backend');
});

test('a run without an API key stops instead of quietly measuring the CLI', () => {
  assert.throws(() => requireSdkBackend({}), TranscribeError);
  assert.equal(requireSdkBackend({ ANTHROPIC_API_KEY: 'test' }), 'sdk');
});

test('every result records exact matches out of 79, inferred ends out of 9, and cost per source', () => {
  assert.equal(record.groundTruth.sets, 79);
  assert.equal(record.groundTruth.inferredEnds, 9);
  assert.ok(record.trials >= 2, 'each model was run more than once');
  for (const r of record.results) {
    assert.equal(r.total, 79, `${r.model} scored against all 79 hand-verified sets`);
    assert.equal(r.inferredExpected, 9, `${r.model} scored against all 9 inferred ends`);
    assert.ok(r.exact >= 0 && r.exact <= 79, `${r.model} exact count is in range`);
    assert.ok(r.inferredFlagged >= 0 && r.inferredFlagged <= 79, `${r.model} inferred count is in range`);
    assert.ok(r.costUsdPerPoster > 0, `${r.model} trial ${r.trial} recorded a cost per source`);
    for (const poster of r.posters) {
      assert.ok(poster.inputTokens > 0 && poster.outputTokens > 0, `${r.model} recorded token usage`);
    }
    assert.ok(
      Math.abs(costUsdPerPoster(r.posters) - r.costUsdPerPoster) < 1e-9,
      `${r.model} cost per source is the mean of its sources`,
    );
  }
});

test('the configured default is the cheapest model that stayed exact in the recorded run', () => {
  const recommended = recommendDefault(record.results);
  assert.ok(recommended, 'at least one model stayed exact');
  assert.equal(config.default, recommended.model, 'the config follows the evidence');
  assert.equal(record.chosen.default, config.default, 'the record and the config agree');
  assert.equal(record.chosen.fallback, config.fallback);
});

test('the named fallback is a model the eval proved readable on every trial', () => {
  const fallback = summarizeByModel(record.results).find((m) => m.model === config.fallback);
  assert.ok(fallback, `${config.fallback} appears in the record`);
  assert.deepEqual(fallback.failures, [], 'the fallback never failed to produce a transcription');
  assert.ok(
    fallback.worstExact >= fallback.total - 1,
    `the fallback stayed within one set of the ground truth (worst ${fallback.worstExact}/${fallback.total})`,
  );
});

test('the decision and its numbers are written down where the config points', () => {
  assert.ok(existsSync(ADR_PATH), 'ADR-0002 records the decision');
  const adr = readFileSync(ADR_PATH, 'utf8');
  assert.ok(
    adr.includes(renderComparison(record)),
    'the ADR carries the comparison table exactly as the record renders it',
  );
  assert.ok(adr.includes(record.measured), `the ADR says when the numbers were measured (${record.measured})`);
  assert.ok(adr.includes(config.default) && adr.includes(config.fallback), 'it names the default and the fallback');
  for (const file of config.decision.split('—')[0]!.trim().split(/\s+/)) {
    if (file.endsWith('.md') || file.endsWith('.json')) {
      assert.ok(existsSync(join(REPO_ROOT, file)), `config points at ${file}, which exists`);
    }
  }
});
