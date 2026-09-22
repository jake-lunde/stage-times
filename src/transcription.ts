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
  readDay,
  titleCase,
  TranscribeError,
  type AppliedEdit,
  type BuiltSet,
  type RawTranscription,
  type SetEdit,
  type TranscriptionOptions,
} from './transcribe.js';

export { TranscribeError, type AppliedEdit, type SetEdit, type TranscriptionOptions };

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
  /** Every human correction applied from the review screen, field by field. */
  edits: AppliedEdit[];
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
    edits: built.edits,
    timezoneAssumed: options.timezoneAssumed === true,
    observations: raws.flatMap((r) => r.observations ?? []),
  };
}

/**
 * The days a set of replies are read as: every day header across every
 * image, ISO, once each, in order. What a link's review shows for the
 * uploader to check, and what a confirm's `days` may move (ticket 20). A
 * reply that will not parse contributes nothing — the full reading says why.
 */
export function daysRead(outputs: ModelOutput[]): string[] {
  const days = new Set<string>();
  for (const o of outputs) {
    try {
      for (const day of parseModelOutput(o.output, o.source).days) days.add(day.date);
    } catch {
      continue;
    }
  }
  return [...days].sort();
}

/**
 * What the replies say the festival is, for matching it against the record
 * of it (src/almanac.ts): the first reply's printed name and the address
 * printed on it, when the reply will parse. A link's uploader typed neither.
 */
export function festivalRead(outputs: ModelOutput[]): { name: string | null; officialUrl: string | null } {
  for (const o of outputs) {
    try {
      const raw = parseModelOutput(o.output, o.source);
      return { name: raw.festival_name || null, officialUrl: raw.official_url ?? null };
    } catch {
      continue;
    }
  }
  return { name: null, officialUrl: null };
}

/**
 * The same replies with their days moved: `from[i]` becomes `to[i]` on every
 * image, and every set printed under it goes with it — the year of the
 * edition too, since that is read from the first day. Each moved reply says
 * so in its observations, so the log records the human's call beside the
 * model's reading. A reply that will not parse is passed through untouched.
 */
export function movedDays(outputs: ModelOutput[], from: string[], to: string[]): ModelOutput[] {
  const moves = new Map(from.map((d, i) => [d, to[i]!]));
  return outputs.map((o) => {
    let raw: RawTranscription;
    try {
      raw = parseModelOutput(o.output, o.source);
    } catch {
      return o;
    }
    const moved = raw.days.filter((d) => moves.has(d.date) && moves.get(d.date) !== d.date);
    if (moved.length === 0) return o;
    const output: RawTranscription = {
      ...raw,
      days: raw.days.map((d) => (moves.has(d.date) ? { ...d, date: moves.get(d.date)! } : d)),
      observations: [
        ...(raw.observations ?? []),
        `Days moved on review: ${moved.map((d) => `${d.date} → ${moves.get(d.date)}`).join(', ')}.`,
      ],
    };
    return { source: o.source, output };
  });
}

/** One stage's closer on one night, as the wait shows it while the rest is read. */
export interface Headliner {
  /** As printed. */
  artist: string;
  /** The stage's display name. */
  stage: string;
  /** The poster day, ISO — the night the set belongs to, whatever the clock says. */
  night: string;
  /** Local wall time, `YYYY-MM-DDTHH:MM:SS`. */
  start: string;
}

/** What one image's reply holds, read on its own: how many sets, and who closes each night. */
export interface ImageReading {
  sets: number;
  headliners: Headliner[];
}

/**
 * One image's reply, read on its own for the wait: the sets on it and each
 * stage's headliner per night — the last set printed under that night, an
 * AFTERS billing skipped unless it is all the stage has (CONTEXT: headliner).
 * Never throws: a reply or a day that will not read counts for nothing, and
 * the full reading, which does throw, says why.
 */
export function readImage(output: ModelOutput): ImageReading {
  let raw: RawTranscription;
  try {
    raw = parseModelOutput(output.output, output.source);
  } catch {
    return { sets: 0, headliners: [] };
  }
  let sets = 0;
  const headliners: Headliner[] = [];
  for (const day of raw.days) {
    let built: ReturnType<typeof readDay>;
    try {
      built = readDay(day, output.source);
    } catch {
      continue;
    }
    sets += built.length;
    let at = 0;
    for (const stage of day.stages) {
      const mine = stage.sets.map((printed, i) => ({ printed, set: built[at + i]! }));
      at += stage.sets.length;
      const closer = mine.filter((m) => !m.printed.afters).at(-1) ?? mine.at(-1);
      if (!closer) continue;
      headliners.push({ artist: closer.set.artist, stage: titleCase(stage.name), night: day.date, start: closer.set.start });
    }
  }
  return { sets, headliners };
}
