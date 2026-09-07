/**
 * Stage Times — the transcription seam.
 *
 * Raw model output in, validated edition document and ambiguity log out.
 *
 * `transcribe()` is a pure function: it reads no files, calls no model, touches
 * no network, and never looks at the clock. Given the same model output and
 * options it returns byte-identical YAML and log text, which is what makes it
 * unit-testable without an API key and safe to call from anywhere — the local
 * CLI (`src/ingest.ts`), the eval harness (`tests/ingest-eval.ts`), and the
 * publisher that the upload flow will build on.
 *
 * Everything that talks to the outside world stays in thin wrappers around it:
 * `src/vision.ts` turns a source image into model output, and the callers own
 * the file I/O. The rules themselves — time resolution, `CLOSE` → +60 min,
 * post-midnight shifts, AFTERS billings, stage ids, YAML and log rendering —
 * live in `src/transcribe.ts`; this module is the only entry point callers
 * should import.
 */

import type { FestivalDoc } from './schema.js';
import {
  assertRawTranscription,
  buildTranscription,
  TranscribeError,
  type BuiltSet,
  type RawTranscription,
  type TranscriptionOptions,
} from './transcribe.js';

export { TranscribeError, type TranscriptionOptions };

/** What the vision model returned for one source image. */
export interface ModelOutput {
  /**
   * Label for the source this output was read from — usually the image file
   * name. Appears in the log header and in every error message.
   */
  source: string;
  /**
   * The model's reply, verbatim: JSON text, tolerated with prose or code fences
   * around the object (the local `claude` CLI does that). Already-parsed JSON
   * is accepted too, so a saved raw file can be replayed either way.
   */
  output: unknown;
}

/** One set as the transcription read it, with the detail the review needs. */
export type TranscribedSet = BuiltSet;

/** The result of transcribing one edition's sources. */
export interface Transcription {
  /**
   * The validated edition document — exactly what `loadFestival` would return
   * for `yaml`, so anything that passes here passes the build. `verified` is
   * always false: a transcription is by definition unchecked by a human.
   */
  edition: FestivalDoc;
  /** The edition YAML, ready to become `data/<slug>-<year>.yaml` once verified. */
  yaml: string;
  /** The ambiguity log — every judgement a human must confirm before publish. */
  log: string;
  /** Every set in printed order, with inferred-end and post-midnight flags. */
  sets: TranscribedSet[];
  /** True when the time zone was a default, not something a human supplied. */
  timezoneAssumed: boolean;
  /** The model's own reviewer notes, verbatim, in source order. */
  observations: string[];
}

/**
 * Pull the one JSON object out of a model reply. Structured-output backends
 * return bare JSON; the CLI backend may wrap it in prose or a code fence.
 */
function parseModelOutput(output: unknown, source: string): RawTranscription {
  let value: unknown = output;
  if (typeof output === 'string') {
    const start = output.indexOf('{');
    const end = output.lastIndexOf('}');
    if (start === -1 || end <= start) {
      throw new TranscribeError(`${source}: no JSON object in the model output:\n${output.slice(0, 500)}`);
    }
    try {
      value = JSON.parse(output.slice(start, end + 1));
    } catch (err) {
      throw new TranscribeError(`${source}: model output is not valid JSON: ${(err as Error).message}`);
    }
  }
  return assertRawTranscription(value, source);
}

/**
 * Transcribe one edition from the model output for each of its sources.
 *
 * Throws `TranscribeError` when the model output cannot be read as a
 * transcription (bad JSON, bad shape, an unparseable printed time, a stage
 * name that derives an unusable id), and `SchemaError` (from `src/schema.ts`)
 * when the resulting edition would not pass the build — including two sets by
 * the same artist on the same stage, which collide on UID and are a hard fail.
 */
export function transcribe(outputs: ModelOutput[], options: TranscriptionOptions): Transcription {
  if (outputs.length === 0) throw new TranscribeError('no model output supplied — nothing to transcribe');
  const raws = outputs.map((o) => parseModelOutput(o.output, o.source));
  const built = buildTranscription(raws, options, outputs.map((o) => o.source));
  return {
    edition: built.doc,
    yaml: built.yaml,
    log: built.log,
    sets: built.sets,
    timezoneAssumed: options.timezoneAssumed === true,
    observations: raws.flatMap((r) => r.observations ?? []),
  };
}
