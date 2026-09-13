/**
 * Stage Times — which vision model transcribes a source, and what it costs.
 *
 * The choice is configuration, not code: `config/vision-models.json` names the
 * default model, the fallback, and the per-million-token price of every model
 * the eval has scored. Revisiting the choice when models change is then a
 * config edit backed by a fresh `npm run ingest:eval` run — the evidence for
 * the current setting is `docs/evals/transcription-models.json` and the ruling
 * is ADR-0002.
 *
 * Nothing here reads a model, the network, or the clock. `loadVisionConfig()`
 * is the one function that touches the filesystem; everything else is pure over
 * a parsed config, so the resolution rules and the fallback are unit-tested
 * without an API key.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repo-relative path of the committed configuration. */
export const VISION_CONFIG_PATH = 'config/vision-models.json';

/** Environment variable that overrides the configured default, for one run. */
export const MODEL_ENV_VAR = 'STAGE_TIMES_VISION_MODEL';

export interface VisionModelEntry {
  /** Display name, for reports and the eval record. */
  label: string;
  /** USD per million input tokens (cache writes and reads included at this rate). */
  inputUsdPerMTok: number;
  /** USD per million output tokens. */
  outputUsdPerMTok: number;
  /**
   * Whether the model is asked for structured output (a JSON schema the reply
   * is guaranteed to validate against). False means the prompt alone asks for
   * JSON and the transcription seam tolerates fences around it.
   */
  structuredOutputs: boolean;
}

export interface VisionConfig {
  /** Model id used for transcription unless the environment overrides it. */
  default: string;
  /** The proven model, used when the default one fails. */
  fallback: string;
  /** Where the prices came from and when. */
  pricingSource: string;
  /** Where the decision and its numbers are written down. */
  decision: string;
  /** Every model the eval has scored, by model id. */
  models: Record<string, VisionModelEntry>;
}

export class ModelConfigError extends Error {
  constructor(sourcePath: string, problem: string) {
    super(`${sourcePath}: ${problem}`);
    this.name = 'ModelConfigError';
  }
}

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const TOP_LEVEL_KEYS = ['default', 'fallback', 'pricingSource', 'decision', 'models'] as const;
const ENTRY_KEYS = ['label', 'inputUsdPerMTok', 'outputUsdPerMTok', 'structuredOutputs'] as const;

function str(value: unknown, path: string, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ModelConfigError(path, `${field} must be a non-empty string`);
  }
  return value;
}

function price(value: unknown, path: string, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new ModelConfigError(path, `${field} must be a positive number of USD per million tokens`);
  }
  return value;
}

/**
 * Validate the configuration text. A model that is chosen but has no price
 * cannot be costed, so an unknown default or fallback is an error rather than
 * something the eval silently reports as free.
 */
export function parseVisionConfig(text: string, sourcePath: string): VisionConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new ModelConfigError(sourcePath, `not valid JSON: ${(err as Error).message}`);
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new ModelConfigError(sourcePath, 'expected a JSON object');
  }
  const record = raw as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!key.startsWith('$') && !(TOP_LEVEL_KEYS as readonly string[]).includes(key)) {
      throw new ModelConfigError(sourcePath, `unknown field ${key} — expected ${TOP_LEVEL_KEYS.join(', ')}`);
    }
  }

  const modelsRaw = record['models'];
  if (typeof modelsRaw !== 'object' || modelsRaw === null || Array.isArray(modelsRaw)) {
    throw new ModelConfigError(sourcePath, 'models must be an object keyed by model id');
  }
  const models: Record<string, VisionModelEntry> = {};
  for (const [id, value] of Object.entries(modelsRaw as Record<string, unknown>)) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new ModelConfigError(sourcePath, `models.${id} must be an object`);
    }
    const entry = value as Record<string, unknown>;
    for (const key of Object.keys(entry)) {
      if (!(ENTRY_KEYS as readonly string[]).includes(key)) {
        throw new ModelConfigError(sourcePath, `unknown field models.${id}.${key}`);
      }
    }
    models[id] = {
      label: str(entry['label'], sourcePath, `models.${id}.label`),
      inputUsdPerMTok: price(entry['inputUsdPerMTok'], sourcePath, `models.${id}.inputUsdPerMTok`),
      outputUsdPerMTok: price(entry['outputUsdPerMTok'], sourcePath, `models.${id}.outputUsdPerMTok`),
      structuredOutputs: entry['structuredOutputs'] !== false,
    };
  }

  const config: VisionConfig = {
    default: str(record['default'], sourcePath, 'default'),
    fallback: str(record['fallback'], sourcePath, 'fallback'),
    pricingSource: str(record['pricingSource'], sourcePath, 'pricingSource'),
    decision: str(record['decision'], sourcePath, 'decision'),
    models,
  };
  for (const field of ['default', 'fallback'] as const) {
    if (!models[config[field]]) {
      throw new ModelConfigError(sourcePath, `${field} ${config[field]} is not in the models catalog`);
    }
  }
  return config;
}

/** Read the committed configuration (or another file, for tests). */
export function loadVisionConfig(path: string = join(REPO_ROOT, VISION_CONFIG_PATH)): VisionConfig {
  return parseVisionConfig(readFileSync(path, 'utf8'), path);
}

/** The catalog entry for `model`, or an error naming what is missing. */
export function visionModel(config: VisionConfig, model: string): VisionModelEntry {
  const entry = config.models[model];
  if (!entry) {
    throw new ModelConfigError(
      VISION_CONFIG_PATH,
      `no price configured for ${model} — add it to the catalog and score it with \`npm run ingest:eval\``,
    );
  }
  return entry;
}

export interface ResolvedModel {
  model: string;
  entry: VisionModelEntry;
  /** 'config' for the committed default, 'environment' for a one-run override. */
  source: 'config' | 'environment';
}

/**
 * Which model this run transcribes with. The committed default, unless
 * `STAGE_TIMES_VISION_MODEL` names another one that the catalog prices.
 */
export function resolveVisionModel(
  config: VisionConfig,
  env: Record<string, string | undefined>,
): ResolvedModel {
  const override = env[MODEL_ENV_VAR];
  const model = override && override.length > 0 ? override : config.default;
  return { model, entry: visionModel(config, model), source: override ? 'environment' : 'config' };
}

/** USD for one call, from the configured price of the model that served it. */
export function costUsd(entry: VisionModelEntry, inputTokens: number, outputTokens: number): number {
  return (inputTokens * entry.inputUsdPerMTok + outputTokens * entry.outputUsdPerMTok) / 1_000_000;
}

export interface FallbackOutcome<T> {
  result: T;
  /** The model that produced `result`. */
  model: string;
  /** True when the default model failed and the proven fallback served instead. */
  fellBack: boolean;
}

/**
 * Transcribe with the chosen model, and if it fails, once more with the proven
 * fallback. `attempt` is injected so the rule is testable without a model; the
 * real one is `transcribeImage` in src/vision.ts.
 *
 * If the fallback fails too, the default model's failure is what surfaces —
 * that is the one a human has to act on. An environment override is deliberate
 * and is never silently replaced.
 */
export async function withModelFallback<T>(
  config: VisionConfig,
  env: Record<string, string | undefined>,
  attempt: (model: string) => Promise<T>,
  onFallback?: (error: Error, fallbackModel: string) => void,
): Promise<FallbackOutcome<T>> {
  const chosen = resolveVisionModel(config, env);
  try {
    return { result: await attempt(chosen.model), model: chosen.model, fellBack: false };
  } catch (err) {
    const error = err as Error;
    if (chosen.model === config.fallback) throw error;
    onFallback?.(error, config.fallback);
    try {
      return { result: await attempt(config.fallback), model: config.fallback, fellBack: true };
    } catch {
      throw error;
    }
  }
}
