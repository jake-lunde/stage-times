/**
 * Stage Times — vision transcription backends.
 *
 * Turns a festival schedule poster image into a RawTranscription (strings
 * exactly as printed; no times resolved, no rules applied — all judgement
 * lives in src/transcribe.ts where it is deterministic and unit-tested).
 *
 * Two backends:
 *   - 'sdk'  — the Anthropic SDK against `claude-opus-5`, with a structured-
 *              output JSON schema so the response is guaranteed parseable.
 *              Needs ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN / an `ant` profile.
 *   - 'cli'  — shells out to the locally installed `claude` CLI (which carries
 *              its own login), asking it to Read the image and emit the same
 *              JSON. Fallback for machines with no API key in the environment.
 *
 * This module is the ONLY nondeterministic step in the ingest pipeline.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename, extname, resolve } from 'node:path';
import { assertRawTranscription, TranscribeError, type RawTranscription } from './transcribe.js';

export type Backend = 'sdk' | 'cli';

export interface VisionResult {
  transcription: RawTranscription;
  backend: Backend;
  model: string;
  /** USD, when the backend reports enough to compute it; null otherwise. */
  costUsd: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
}

/** Latest capable vision model (per the claude-api reference). */
export const SDK_MODEL = 'claude-opus-5';
/** claude-opus-5 pricing, USD per token. */
const INPUT_USD_PER_TOKEN = 5 / 1_000_000;
const OUTPUT_USD_PER_TOKEN = 25 / 1_000_000;

// ---------------------------------------------------------------------------
// The transcription prompt — encodes the CHBP-proven reading discipline.
// ---------------------------------------------------------------------------

export const TRANSCRIPTION_PROMPT = `You are transcribing a music-festival daily schedule poster for a calendar-feed pipeline. A wrong set time in a published feed is the worst failure this project has, so transcribe with forensic care. Examine every column closely (mentally re-read each name at 2x) before answering.

Rules — these are hard requirements:
1. Preserve every string EXACTLY as printed: character-for-character, including uppercase, punctuation, underscores, repeated letters, unusual or "misspelled-looking" names, and British spellings. Never normalize, never fix, never guess casing. If a name looks like an OCR error, re-read it and report it in "observations" instead of correcting it.
2. Times go in "time" exactly as printed, e.g. "3:15-3:45PM" or "10:40-CLOSE". If the poster prints CLOSE instead of an end time, reproduce the literal word CLOSE. Do NOT invent an end time and do NOT resolve AM/PM — downstream code does that.
3. If a block is labelled AFTERS (or similar afters billing), set "afters": true and put the label in neither "artist" nor "time". Inline parentheticals that are part of the billing line (e.g. "TINASHE (DJ SET)") stay in "artist"; standalone annotations printed separately from the name (e.g. "(DJ SETS)") go in "annotations".
4. Read the day header exactly as printed into "header" and convert it to an ISO date in "date" (YYYY-MM-DD). Double-check the weekday against the date.
5. Keep sets in printed top-to-bottom order within each stage, and stages in printed order.
6. "festival_name" is the festival name as printed (keep poster casing). "official_url" is any URL printed on the poster (usually the footer), or null.
7. Use "observations" for anything a human reviewer should double-check: hard-to-read text, names that look like OCR errors but are printed that way, artists appearing twice, unusual layout, partially obscured text. Do not silently guess — say so.

Respond with a single JSON object of this shape and nothing else:
{
  "festival_name": string,
  "official_url": string | null,
  "days": [
    {
      "date": "YYYY-MM-DD",
      "header": string,
      "stages": [
        {
          "name": string,
          "sets": [
            { "artist": string, "time": string, "afters": boolean, "annotations": [string, ...] }
          ]
        }
      ]
    }
  ],
  "observations": [string, ...]
}`;

/** JSON schema for structured outputs (SDK backend). */
const TRANSCRIPTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['festival_name', 'official_url', 'days', 'observations'],
  properties: {
    festival_name: { type: 'string' },
    official_url: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    days: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['date', 'header', 'stages'],
        properties: {
          date: { type: 'string', format: 'date' },
          header: { type: 'string' },
          stages: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['name', 'sets'],
              properties: {
                name: { type: 'string' },
                sets: {
                  type: 'array',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['artist', 'time', 'afters', 'annotations'],
                    properties: {
                      artist: { type: 'string' },
                      time: { type: 'string' },
                      afters: { type: 'boolean' },
                      annotations: { type: 'array', items: { type: 'string' } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    observations: { type: 'array', items: { type: 'string' } },
  },
} as const;

// ---------------------------------------------------------------------------
// Backend selection
// ---------------------------------------------------------------------------

export function sdkCredentialsAvailable(): boolean {
  return Boolean(process.env['ANTHROPIC_API_KEY'] || process.env['ANTHROPIC_AUTH_TOKEN']);
}

export function cliAvailable(): boolean {
  try {
    execFileSync('claude', ['--version'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

export function pickBackend(): Backend {
  if (sdkCredentialsAvailable()) return 'sdk';
  if (cliAvailable()) return 'cli';
  throw new TranscribeError(
    'no usable Claude access: set ANTHROPIC_API_KEY (or ANTHROPIC_AUTH_TOKEN), or install the `claude` CLI and log in',
  );
}

// ---------------------------------------------------------------------------
// SDK backend
// ---------------------------------------------------------------------------

const MEDIA_TYPES: Record<string, string> = {
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
};

function mediaTypeFor(imagePath: string): string {
  const type = MEDIA_TYPES[extname(imagePath).toLowerCase()];
  if (!type) {
    throw new TranscribeError(
      `unsupported image type ${extname(imagePath)} — expected one of ${Object.keys(MEDIA_TYPES).join(', ')}`,
    );
  }
  return type;
}

async function transcribeViaSdk(imagePath: string): Promise<VisionResult> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic();
  const data = readFileSync(imagePath).toString('base64');

  const response = await client.messages.create({
    model: SDK_MODEL,
    max_tokens: 16000,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mediaTypeFor(imagePath) as 'image/webp', data },
          },
          { type: 'text', text: TRANSCRIPTION_PROMPT },
        ],
      },
    ],
    // Structured outputs: the response is guaranteed to validate against the
    // schema, so a parse failure can only mean an API-level problem.
    output_config: {
      format: { type: 'json_schema', schema: TRANSCRIPTION_SCHEMA as unknown as Record<string, unknown> },
    },
  });

  if (response.stop_reason === 'refusal') {
    throw new TranscribeError(
      `the model declined to transcribe ${basename(imagePath)} (stop_reason: refusal) — retry or transcribe by hand`,
    );
  }
  if (response.stop_reason === 'max_tokens') {
    throw new TranscribeError(`transcription of ${basename(imagePath)} was truncated (max_tokens) — raise the limit`);
  }
  const text = response.content.find((b) => b.type === 'text')?.text;
  if (!text) throw new TranscribeError(`no text block in the response for ${basename(imagePath)}`);

  const usage = response.usage;
  const inputTokens =
    usage.input_tokens + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
  return {
    transcription: assertRawTranscription(JSON.parse(text), basename(imagePath)),
    backend: 'sdk',
    model: response.model,
    costUsd: inputTokens * INPUT_USD_PER_TOKEN + usage.output_tokens * OUTPUT_USD_PER_TOKEN,
    inputTokens,
    outputTokens: usage.output_tokens,
  };
}

// ---------------------------------------------------------------------------
// claude CLI backend
// ---------------------------------------------------------------------------

function transcribeViaCli(imagePath: string): VisionResult {
  const abs = resolve(imagePath);
  const prompt =
    `First use your Read tool to view the image file at ${abs} (view it closely — re-read every column before answering).\n\n` +
    TRANSCRIPTION_PROMPT +
    '\n\nYour final reply must be ONLY the JSON object — no prose, no code fences.';

  const stdout = execFileSync(
    'claude',
    ['-p', prompt, '--output-format', 'json', '--model', 'opus', '--allowedTools', 'Read'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 15 * 60 * 1000 },
  );

  let envelope: {
    result?: string;
    total_cost_usd?: number;
    modelUsage?: Record<string, { costUSD?: number }>;
  };
  try {
    envelope = JSON.parse(stdout);
  } catch {
    throw new TranscribeError(`claude CLI did not return JSON for ${basename(imagePath)}:\n${stdout.slice(0, 500)}`);
  }
  const result = envelope.result ?? '';
  const start = result.indexOf('{');
  const end = result.lastIndexOf('}');
  if (start === -1 || end <= start) {
    throw new TranscribeError(`no JSON object in the claude CLI result for ${basename(imagePath)}:\n${result.slice(0, 500)}`);
  }
  // The envelope lists every model the CLI touched (including tiny helper
  // calls); report the one that did the work — the biggest spender.
  const model = Object.entries(envelope.modelUsage ?? {})
    .sort((a, b) => (b[1].costUSD ?? 0) - (a[1].costUSD ?? 0))
    .map(([id]) => id)[0] ?? 'claude (cli)';
  return {
    transcription: assertRawTranscription(JSON.parse(result.slice(start, end + 1)), basename(imagePath)),
    backend: 'cli',
    model,
    costUsd: typeof envelope.total_cost_usd === 'number' ? envelope.total_cost_usd : null,
    inputTokens: null,
    outputTokens: null,
  };
}

// ---------------------------------------------------------------------------
// Public entry
// ---------------------------------------------------------------------------

export async function transcribeImage(imagePath: string, backend: Backend): Promise<VisionResult> {
  return backend === 'sdk' ? transcribeViaSdk(imagePath) : transcribeViaCli(imagePath);
}
