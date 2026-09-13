/**
 * The vision-model choice: which model transcribes a source, what it costs,
 * and what happens when it fails.
 *
 * The choice is configuration (`config/vision-models.json`), not a literal in
 * the code, so revisiting it when models change is a config edit backed by a
 * fresh eval run — never a code change. Everything here runs without an API
 * key: the config is parsed from text and the fallback is exercised against a
 * fake transcriber.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  costUsd,
  loadVisionConfig,
  parseVisionConfig,
  resolveVisionModel,
  VISION_CONFIG_PATH,
  visionModel,
  ModelConfigError,
  withModelFallback,
  type VisionConfig,
} from '../src/models.js';
import { REPO_ROOT } from './helpers.js';

const CONFIG_TEXT = readFileSync(join(REPO_ROOT, VISION_CONFIG_PATH), 'utf8');

function configText(overrides: Record<string, unknown>): string {
  return JSON.stringify({ ...(JSON.parse(CONFIG_TEXT) as object), ...overrides });
}

// ---------------------------------------------------------------------------
// The committed configuration
// ---------------------------------------------------------------------------

test('the committed vision-model config parses, and names a default and a fallback', () => {
  const config = loadVisionConfig();
  assert.ok(config.default.length > 0, 'a default model is configured');
  assert.ok(config.fallback.length > 0, 'a fallback model is named');
  assert.ok(config.models[config.default], `the default ${config.default} is in the catalog`);
  assert.ok(config.models[config.fallback], `the fallback ${config.fallback} is in the catalog`);
});

test('the default transcription model is read from configuration, not hard-coded in src/', () => {
  // Point the resolver at a different config and the answer changes — which is
  // only true if nothing downstream carries a model id of its own.
  const swapped = parseVisionConfig(
    configText({ default: 'claude-haiku-4-5-20251001' }),
    'in-memory config',
  );
  assert.equal(resolveVisionModel(swapped, {}).model, 'claude-haiku-4-5-20251001');
  assert.equal(resolveVisionModel(swapped, {}).source, 'config');

  // And no module in src/ pins a model id in code.
  for (const file of ['vision.ts', 'ingest.ts', 'transcription.ts', 'transcribe.ts']) {
    const text = readFileSync(join(REPO_ROOT, 'src', file), 'utf8');
    const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.equal(
      /claude-(opus|sonnet|haiku|fable)-[\d-]/.test(code),
      false,
      `src/${file} names a model id in code — the choice belongs in ${VISION_CONFIG_PATH}`,
    );
  }
});

test('an environment override replaces the configured default and says where it came from', () => {
  const config = loadVisionConfig();
  const resolved = resolveVisionModel(config, { STAGE_TIMES_VISION_MODEL: config.fallback });
  assert.equal(resolved.model, config.fallback);
  assert.equal(resolved.source, 'environment');
});

test('an override naming a model with no configured price is refused', () => {
  const config = loadVisionConfig();
  assert.throws(
    () => resolveVisionModel(config, { STAGE_TIMES_VISION_MODEL: 'claude-imaginary-9' }),
    ModelConfigError,
    'an unpriced model cannot be costed, so it cannot be chosen',
  );
});

test('a config whose default or fallback is missing from the catalog is refused', () => {
  assert.throws(
    () => parseVisionConfig(configText({ default: 'claude-imaginary-9' }), 'in-memory config'),
    ModelConfigError,
  );
  assert.throws(
    () => parseVisionConfig(configText({ fallback: 'claude-imaginary-9' }), 'in-memory config'),
    ModelConfigError,
  );
  assert.throws(() => parseVisionConfig(configText({ models: {} }), 'in-memory config'), ModelConfigError);
});

// ---------------------------------------------------------------------------
// Cost
// ---------------------------------------------------------------------------

test('cost is computed from the configured per-million price of the model used', () => {
  const config = loadVisionConfig();
  const entry = visionModel(config, config.fallback);
  assert.equal(
    costUsd(entry, 1_000_000, 1_000_000),
    entry.inputUsdPerMTok + entry.outputUsdPerMTok,
    'a million of each token costs exactly the two configured prices',
  );
  assert.equal(costUsd(entry, 0, 0), 0);
});

test('every catalog entry carries a positive input and output price', () => {
  const config = loadVisionConfig();
  for (const [id, entry] of Object.entries(config.models)) {
    assert.ok(entry.inputUsdPerMTok > 0, `${id} has an input price`);
    assert.ok(entry.outputUsdPerMTok > 0, `${id} has an output price`);
    assert.ok(entry.label.length > 0, `${id} has a display label`);
  }
});

// ---------------------------------------------------------------------------
// The fallback
// ---------------------------------------------------------------------------

function fakeResult(model: string): { model: string } {
  return { model };
}

test('the default model does the work and the fallback is not called', async () => {
  const config = loadVisionConfig();
  const tried: string[] = [];
  const out = await withModelFallback(config, {}, async (model) => {
    tried.push(model);
    return fakeResult(model);
  });
  assert.deepEqual(tried, [config.default]);
  assert.equal(out.fellBack, false);
  assert.equal(out.result.model, config.default);
});

test('the proven model is the fallback and takes over when the default model fails', async () => {
  const config = loadVisionConfig();
  const tried: string[] = [];
  const out = await withModelFallback(config, {}, async (model) => {
    tried.push(model);
    if (model === config.default && config.default !== config.fallback) {
      throw new Error('overloaded');
    }
    return fakeResult(model);
  });
  if (config.default === config.fallback) {
    assert.deepEqual(tried, [config.default], 'default and fallback are the same model — one attempt');
    assert.equal(out.fellBack, false);
  } else {
    assert.deepEqual(tried, [config.default, config.fallback]);
    assert.equal(out.fellBack, true);
    assert.equal(out.result.model, config.fallback);
  }
});

test('when the fallback fails too, the original failure is reported', async () => {
  const config: VisionConfig = parseVisionConfig(
    configText({ default: 'claude-haiku-4-5-20251001', fallback: 'claude-opus-5' }),
    'in-memory config',
  );
  await assert.rejects(
    () =>
      withModelFallback(config, {}, async (model) => {
        throw new Error(`${model} is down`);
      }),
    /claude-haiku-4-5-20251001 is down/,
    'the default model’s failure is the one a human has to act on',
  );
});
