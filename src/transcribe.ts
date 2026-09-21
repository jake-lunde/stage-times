/**
 * Stage Times — transcription rules (internal).
 *
 * The public entry point is `transcribe()` in `src/transcription.ts`; import
 * from there. This module holds the deterministic rules it applies.
 *
 * Takes the *raw transcription* a vision model produced from a schedule poster
 * (strings exactly as printed, nothing resolved) and deterministically turns it
 * into:
 *   1. an edition document in the repo's canonical YAML format, and
 *   2. a TRANSCRIPTION.md-style ambiguity log.
 *
 * Every judgement call proven during the CHBP hand-transcription is encoded
 * here, NOT left to the model:
 *   - raw strings preserved exactly as printed (poster uppercase kept as-is)
 *   - `CLOSE` end times, and a start printed alone → start + 60 min, `end_inferred: true`
 *   - post-midnight times shift to the next calendar date
 *   - combined AFTERS billings stay one event
 *   - duplicate UIDs are a hard fail (via src/schema.ts validation)
 *
 * No clock reads, no randomness, no network, no filesystem — given the same
 * raw transcription this module always produces byte-identical output, so it
 * is unit-testable without an API key.
 */

import {
  loadFestivalFromString,
  normalizeArtist,
  stageIdProblem,
  type FestivalDoc,
  type Namespace,
} from './schema.js';

// ---------------------------------------------------------------------------
// Raw transcription — what the vision model returns
// ---------------------------------------------------------------------------

/** One printed set line, exactly as it appears on the poster. */
export interface RawSet {
  /**
   * Artist billing exactly as printed, including inline parentheticals like
   * "TINASHE (DJ SET)" — but NOT including a printed `AFTERS` label or
   * standalone annotations, which go in `afters` / `annotations`.
   */
  artist: string;
  /** Time exactly as printed, e.g. "3:15-3:45PM", "11:30-CLOSE", or a headliner's bare "8:15". */
  time: string;
  /** True when the poster labels this block `AFTERS`. */
  afters?: boolean;
  /** Standalone printed annotations on the block, e.g. "(DJ SETS)". */
  annotations?: string[];
}

export interface RawStage {
  /** Stage name exactly as printed, e.g. "MAIN STAGE". */
  name: string;
  /** Sets in printed (top-to-bottom) order. */
  sets: RawSet[];
}

export interface RawDay {
  /** ISO date derived from the poster's day header, e.g. "2026-08-07". */
  date: string;
  /** The day header exactly as printed, e.g. "FRIDAY AUGUST 7, 2026". */
  header: string;
  stages: RawStage[];
}

export interface RawTranscription {
  /** Festival name as printed on the poster (usually uppercase). */
  festival_name: string;
  /** URL printed on the poster (footer), if any. */
  official_url?: string | null;
  days: RawDay[];
  /** Free-form model observations: low-confidence reads, oddities, etc. */
  observations?: string[];
}

export class TranscribeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TranscribeError';
  }
}

/** Runtime-validate a parsed JSON value as a RawTranscription. */
export function assertRawTranscription(value: unknown, label: string): RawTranscription {
  const problems: string[] = [];
  const root = value as RawTranscription;
  if (root === null || typeof root !== 'object') {
    throw new TranscribeError(`${label}: transcription must be a JSON object`);
  }
  if (typeof root.festival_name !== 'string' || root.festival_name.trim() === '') {
    problems.push('`festival_name` must be a non-empty string');
  }
  if (!Array.isArray(root.days) || root.days.length === 0) {
    problems.push('`days` must be a non-empty array');
  } else {
    root.days.forEach((day, di) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day?.date ?? '')) {
        problems.push(`days[${di}].date must be YYYY-MM-DD (got ${JSON.stringify(day?.date)})`);
      }
      if (typeof day?.header !== 'string') problems.push(`days[${di}].header must be a string`);
      if (!Array.isArray(day?.stages) || day.stages.length === 0) {
        problems.push(`days[${di}].stages must be a non-empty array`);
        return;
      }
      day.stages.forEach((stage, si) => {
        if (typeof stage?.name !== 'string' || stage.name.trim() === '') {
          problems.push(`days[${di}].stages[${si}].name must be a non-empty string`);
        }
        if (!Array.isArray(stage?.sets) || stage.sets.length === 0) {
          problems.push(`days[${di}].stages[${si}].sets must be a non-empty array`);
          return;
        }
        stage.sets.forEach((set, ei) => {
          const where = `days[${di}].stages[${si}].sets[${ei}]`;
          if (typeof set?.artist !== 'string' || set.artist.trim() === '') {
            problems.push(`${where}.artist must be a non-empty string`);
          }
          if (typeof set?.time !== 'string' || set.time.trim() === '') {
            problems.push(`${where}.time must be a non-empty string`);
          }
        });
      });
    });
  }
  if (problems.length > 0) {
    throw new TranscribeError(`${label}: bad transcription shape:\n` + problems.map((p) => `  • ${p}`).join('\n'));
  }
  return root;
}

// ---------------------------------------------------------------------------
// Time parsing
// ---------------------------------------------------------------------------

const TIME_RANGE_RE =
  /^(\d{1,2}):(\d{2})\s*(AM|PM)?\s*[-–—]\s*(?:(\d{1,2}):(\d{2})\s*(AM|PM)?|(CLOSE))$/i;
/** A start with nothing after it — how ACL prints its headliners ("SKRILLEX 8:15"). */
const TIME_START_RE = /^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i;

interface ClockReading {
  hour: number;
  minute: number;
  meridiem: 'AM' | 'PM' | null;
}

export interface ParsedRange {
  start: ClockReading;
  /** null when the poster printed no end time — CLOSE, or nothing at all. */
  end: ClockReading | null;
  /** How the missing end was printed: the word CLOSE, or a start standing alone. */
  noEnd?: 'close' | 'bare';
}

export function parseTimeRange(time: string): ParsedRange {
  const bare = TIME_START_RE.exec(time.trim());
  if (bare) {
    const start: ClockReading = { hour: Number(bare[1]), minute: Number(bare[2]), meridiem: bare[3] ? (bare[3].toUpperCase() as 'AM' | 'PM') : null };
    if (start.hour < 1 || start.hour > 12 || start.minute > 59) {
      throw new TranscribeError(`printed time ${JSON.stringify(time)} has an out-of-range clock reading`);
    }
    return { start, end: null, noEnd: 'bare' };
  }
  const m = TIME_RANGE_RE.exec(time.trim());
  if (!m) {
    throw new TranscribeError(
      `cannot parse printed time ${JSON.stringify(time)} — expected "H:MM-H:MM(AM|PM)", "H:MM-CLOSE" or a bare "H:MM"`,
    );
  }
  const start: ClockReading = {
    hour: Number(m[1]),
    minute: Number(m[2]),
    meridiem: m[3] ? (m[3].toUpperCase() as 'AM' | 'PM') : null,
  };
  const end: ClockReading | null = m[7]
    ? null
    : { hour: Number(m[4]), minute: Number(m[5]), meridiem: m[6] ? (m[6].toUpperCase() as 'AM' | 'PM') : null };
  for (const t of end ? [start, end] : [start]) {
    if (t.hour < 1 || t.hour > 12 || t.minute > 59) {
      throw new TranscribeError(`printed time ${JSON.stringify(time)} has an out-of-range clock reading`);
    }
  }
  return end ? { start, end } : { start, end, noEnd: 'close' };
}

/** Minutes-into-day candidates for a possibly meridiem-less clock reading. */
function candidates(t: ClockReading): number[] {
  const am = (t.hour % 12) * 60 + t.minute;
  const pm = ((t.hour % 12) + 12) * 60 + t.minute;
  if (t.meridiem === 'AM') return [am];
  if (t.meridiem === 'PM') return [pm];
  return [am, pm];
}

/**
 * Resolve a parsed range to minutes-into-day for start and end.
 *
 * Posters usually print the meridiem on the end time only ("3:15-3:45PM").
 * When a reading is unmarked we pick the interpretation that gives the
 * shortest positive duration; ties prefer the evening reading (these are
 * festival schedules). `CLOSE` ends resolve to null here — the caller applies
 * the +60min rule so the inference stays visible at one site.
 *
 * `prevStartMin` is the previous set's resolved start on the same stage (in
 * absolute minutes mod 1440), used to disambiguate an unmarked start when the
 * end is CLOSE.
 */
export function resolveRange(
  range: ParsedRange,
  prevStartMin: number | null,
): { startMin: number; endMin: number | null } {
  const startCands = candidates(range.start);
  if (range.end === null) {
    // CLOSE: pick the start candidate consistent with running order — the
    // first one at or after the previous set's start; otherwise evening.
    let startMin = startCands[startCands.length - 1]!;
    if (prevStartMin !== null) {
      const ordered = startCands.filter((c) => c >= prevStartMin % 1440);
      if (ordered.length > 0) startMin = ordered[0]!;
    }
    return { startMin, endMin: null };
  }
  const endCands = candidates(range.end);
  let best: { startMin: number; endMin: number; duration: number } | null = null;
  for (const s of startCands) {
    for (const e of endCands) {
      const duration = (e - s + 1440) % 1440;
      if (duration === 0) continue;
      // Prefer strictly shorter durations; on a tie prefer the later (evening)
      // start — iteration order puts PM candidates last, so `<=` does that.
      if (best === null || duration < best.duration || (duration === best.duration && s > best.startMin)) {
        best = { startMin: s, endMin: e, duration };
      }
    }
  }
  if (best === null) {
    throw new TranscribeError('printed time range resolves to a zero-length set');
  }
  return { startMin: best.startMin, endMin: best.endMin };
}

// ---------------------------------------------------------------------------
// Stage identity
// ---------------------------------------------------------------------------

/** "MAIN STAGE" → "main"; "DAYDREAM STAGE" → "daydream". Hard-fails on bad ids. */
export function stageIdFromName(name: string): string {
  const id = name
    .trim()
    .toLowerCase()
    .replace(/\s+stage$/i, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const problem = stageIdProblem(id);
  if (problem) {
    throw new TranscribeError(
      `stage name ${JSON.stringify(name)} derives id ${JSON.stringify(id)}, which ${problem}. ` +
        'Stage ids are permanent URL slugs — pick the id by hand before publishing.',
    );
  }
  return id;
}

/** "MAIN STAGE" → "Main Stage". Display text only — never feeds a UID. */
export function titleCase(text: string): string {
  return text
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

/** "Capitol Hill Block Party" → "capitol-hill-block-party". */
export function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ---------------------------------------------------------------------------
// Building the festival document
// ---------------------------------------------------------------------------

/**
 * One correction a human made on the review screen, addressed by the set's
 * position in printed order (`BuiltSet` index — what the review payload shows).
 *
 * Only the three fields the review screen exposes can be edited: artist, start,
 * end. Times are local wall-clock strings in the edition's zone,
 * `YYYY-MM-DDTHH:MM:SS`, exactly as the YAML carries them; anything else is
 * caught by the schema on the round-trip, naming the set.
 */
export interface SetEdit {
  index: number;
  artist?: string;
  start?: string;
  end?: string;
}

/** One field of one set, as the human changed it. Rendered into the log. */
export interface AppliedEdit {
  index: number;
  stage: string;
  /** The artist the set was read as, before any edit on this set. */
  artist: string;
  field: 'artist' | 'start' | 'end';
  from: string;
  to: string;
}

export interface TranscriptionOptions {
  /**
   * Which URL family the edition will publish into: `owner` at the root,
   * `fan` under `/fan/` (ADR-0001). Required, no default — the poster cannot
   * know this, and it is permanent from first publish.
   */
  namespace: Namespace;
  /** Festival display name. Defaults to a title-cased poster name. */
  name?: string;
  /** URL slug. Defaults to slugified name. PERMANENT once published. */
  slug?: string;
  /** IANA timezone. Required knowledge the poster does not carry. */
  timezone: string;
  /** True when the timezone was assumed rather than supplied by a human. */
  timezoneAssumed?: boolean;
  /** Official URL. Defaults to the poster footer URL, if any. */
  officialUrl?: string;
  /**
   * Corrections a human made against the source, applied after the rules run
   * and before the YAML is rendered. Every one is recorded in the log.
   */
  edits?: SetEdit[];
  /**
   * True when a human has checked every set against the source image — the
   * uploader's confirm, or the owner's. Writes `verified: true`, which is what
   * a production build requires. Defaults to false: a transcription nobody has
   * looked at is never pre-verified.
   */
  verified?: boolean;
}

export interface BuiltSet {
  stage: string;
  artist: string;
  raw: string;
  start: string;
  end: string;
  end_inferred: boolean;
  notes: string;
  /** Poster day this set was printed under (for per-day reporting). */
  posterDate: string;
  /** Label of the source this set was read from — its entry in `sources`. */
  source: string;
  /** Printed time string, for the log. */
  printedTime: string;
  /** Crossed midnight relative to the poster day. */
  crossesMidnight: boolean;
  /** The artist as printed, when the name was suffixed to tell repeat bookings apart. */
  printedArtist?: string;
}

export interface BuiltTranscription {
  doc: FestivalDoc;
  yaml: string;
  log: string;
  sets: BuiltSet[];
  /** Every human correction that was applied, field by field, in set order. */
  edits: AppliedEdit[];
  festival: { name: string; slug: string; year: number; timezone: string; official_url: string };
  stages: { id: string; name: string }[];
}

/**
 * Apply the review screen's corrections to the built sets, in place of the
 * machine's reading, and report each one for the log.
 *
 * An edited end is no longer an inference, so `end_inferred` clears: the human
 * typed the time off the source. An edited start leaves it alone — the end is
 * still whatever it was.
 */
export function applyEdits(sets: BuiltSet[], edits: SetEdit[]): AppliedEdit[] {
  const applied: AppliedEdit[] = [];
  for (const edit of edits) {
    const set = sets[edit.index];
    if (!set) {
      throw new TranscribeError(
        `review edit points at set ${edit.index}, but the transcription has ${sets.length} sets (0-${sets.length - 1})`,
      );
    }
    const artistBefore = set.artist;
    const record = (field: AppliedEdit['field'], from: string, to: string) => {
      if (from === to) return;
      applied.push({ index: edit.index, stage: set.stage, artist: artistBefore, field, from, to });
    };
    if (edit.artist !== undefined) {
      record('artist', set.artist, edit.artist);
      set.artist = edit.artist;
    }
    if (edit.start !== undefined) {
      record('start', set.start, edit.start);
      set.start = edit.start;
    }
    if (edit.end !== undefined) {
      record('end', set.end, edit.end);
      if (set.end !== edit.end && set.end_inferred) {
        set.end_inferred = false;
        // The no-end note described a guess this edit just replaced.
        set.notes = set.notes
          .replace(CLOSE_NOTE, 'End time not printed (CLOSE); read off the source on review.')
          .replace(BARE_NOTE, 'End time not printed; read off the source on review.')
          .trim();
      }
      set.end = edit.end;
    }
    // The "crosses midnight" YAML comment is a statement about the times, so it
    // has to follow them rather than the reading they replaced.
    set.crossesMidnight = set.end.slice(0, 10) !== set.posterDate;
  }
  return applied;
}

function isoAt(baseDate: string, absMinutes: number): string {
  const [y, mo, d] = baseDate.split('-').map(Number) as [number, number, number];
  const dayShift = Math.floor(absMinutes / 1440);
  const minutes = absMinutes - dayShift * 1440;
  const date = new Date(Date.UTC(y, mo - 1, d + dayShift));
  const p2 = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getUTCFullYear()}-${p2(date.getUTCMonth() + 1)}-${p2(date.getUTCDate())}` +
    `T${p2(Math.floor(minutes / 60))}:${p2(minutes % 60)}:00`
  );
}

/**
 * The schema requires a non-empty http(s) `official_url`, but posters print
 * bare (often uppercase) domains in the footer. Normalize deterministically;
 * the log flags the URL as unverified either way.
 */
export const NO_OFFICIAL_URL = 'no official URL found on the poster — pass --official-url (the schema requires one)';

export function normalizeOfficialUrl(url: string): string {
  const trimmed = url.trim();
  if (trimmed === '') {
    throw new TranscribeError(NO_OFFICIAL_URL);
  }
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed.toLowerCase()}`;
}

function buildRaw(set: RawSet): string {
  if (!set.afters) return set.artist;
  return ['AFTERS', set.artist, ...(set.annotations ?? []), set.time].join(' / ');
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function weekdayName(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  return WEEKDAY_NAMES[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]!;
}

/** `2026-10-02T20:00:00` → `8:00 PM`. */
function clockOf(iso: string): string {
  const [h, m] = iso.slice(11, 16).split(':').map(Number) as [number, number];
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/**
 * Suffix the artist of every set that shares its stage with another set of
 * the same artist, so each is its own event with its own UID. Same stage,
 * same normalized name, different days → `(Friday)`; any two on one day →
 * `(Friday 1:30 PM)` for the whole group, so a group reads one way.
 */
export function disambiguateRepeats(sets: BuiltSet[]): void {
  const groups = new Map<string, BuiltSet[]>();
  for (const s of sets) {
    const key = `${s.stage}\0${normalizeArtist(s.artist)}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(s);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const oneADay = new Set(group.map((s) => s.posterDate)).size === group.length;
    for (const s of group) {
      const tag = oneADay ? weekdayName(s.posterDate) : `${weekdayName(s.posterDate)} ${clockOf(s.start)}`;
      s.printedArtist = s.artist;
      s.artist = `${s.artist} (${tag})`;
      s.notes = [s.notes, `Billed more than once on this stage; "(${tag})" tells the events apart.`].filter(Boolean).join(' ');
    }
  }
}

/** The notes a missing end carries, and what a review edit replaces. */
const CLOSE_NOTE = 'End time not printed (CLOSE); assumed 60 minutes.';
const BARE_NOTE = 'End time not printed; assumed 60 minutes.';

function buildNotes(set: RawSet, noEnd: 'close' | 'bare' | undefined): string {
  const parts: string[] = [];
  if (set.afters) {
    const dj = (set.annotations ?? []).some((a) => /dj set/i.test(a));
    parts.push(dj ? 'Billed as AFTERS, DJ sets.' : 'Billed as AFTERS.');
    if (set.artist.includes(' + ')) {
      parts.push('Two acts on one printed block — kept as one event.');
    }
  }
  if (noEnd === 'close') parts.push(CLOSE_NOTE);
  if (noEnd === 'bare') parts.push(BARE_NOTE);
  return parts.join(' ');
}

/**
 * Turn raw transcriptions (one per poster image) into a validated festival
 * document, YAML text, and a TRANSCRIPTION.md-style log.
 *
 * Throws SchemaError (from validateDoc) on anything the build could
 * mis-publish — including duplicate UIDs, which are a hard fail.
 */
export function buildTranscription(
  transcriptions: RawTranscription[],
  options: TranscriptionOptions,
  sources: string[],
): BuiltTranscription {
  if (transcriptions.length === 0) throw new TranscribeError('no transcriptions supplied');

  const days = transcriptions
    .flatMap((t) => t.days)
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date));
  // Dates are unique across sources (checked next), so a date names its source.
  const sourceOfDate = new Map<string, string>();
  transcriptions.forEach((t, i) => {
    for (const day of t.days) sourceOfDate.set(day.date, sources[i] ?? '');
  });
  const seenDates = new Set<string>();
  for (const day of days) {
    if (seenDates.has(day.date)) {
      throw new TranscribeError(
        `two posters transcribed to the same date ${day.date} — check that each image is a distinct day`,
      );
    }
    seenDates.add(day.date);
  }

  const posterName = transcriptions[0]!.festival_name.trim();
  const name =
    options.name ?? (posterName === posterName.toUpperCase() ? titleCase(posterName) : posterName);
  const slug = options.slug ?? slugify(name);
  const year = Number(days[0]!.date.slice(0, 4));
  const officialUrl = normalizeOfficialUrl(
    options.officialUrl ?? transcriptions.map((t) => t.official_url).find((u) => u) ?? '',
  );

  // Stages: unique by derived id, in order of first appearance.
  const stages: { id: string; name: string }[] = [];
  const stageIds = new Map<string, string>();
  for (const day of days) {
    for (const stage of day.stages) {
      const id = stageIdFromName(stage.name);
      if (!stageIds.has(id)) {
        stageIds.set(id, stage.name);
        stages.push({ id, name: titleCase(stage.name) });
      }
    }
  }

  // Sets, day by day, stage by stage, in printed order.
  const sets: BuiltSet[] = [];
  for (const day of days) {
    for (const stage of day.stages) {
      const stageId = stageIdFromName(stage.name);
      let dayOffset = 0;
      let prevAbsStart: number | null = null;
      for (const rawSet of stage.sets) {
        const range = parseTimeRange(rawSet.time);
        const { startMin, endMin } = resolveRange(range, prevAbsStart);
        let absStart = startMin + dayOffset * 1440;
        if (prevAbsStart !== null && absStart < prevAbsStart) {
          // A set printed later in the column that starts at an earlier clock
          // time has crossed midnight: shift to the next calendar date.
          dayOffset += 1;
          absStart += 1440;
        }
        const isClose = endMin === null;
        let absEnd: number;
        if (isClose) {
          absEnd = absStart + 60; // owner's rule: no printed end → start + 60 min
        } else {
          absEnd = endMin + dayOffset * 1440;
          while (absEnd <= absStart) absEnd += 1440;
        }
        sets.push({
          stage: stageId,
          artist: rawSet.artist,
          raw: buildRaw(rawSet),
          start: isoAt(day.date, absStart),
          end: isoAt(day.date, absEnd),
          end_inferred: isClose,
          notes: buildNotes(rawSet, isClose ? range.noEnd : undefined),
          posterDate: day.date,
          source: sourceOfDate.get(day.date)!,
          printedTime: rawSet.time,
          crossesMidnight: absEnd >= 1440,
        });
        prevAbsStart = absStart;
      }
    }
  }

  // The same artist twice on one stage collides on UID — the known limitation
  // (README): UID excludes the start time on purpose. ACL runs a silent disco
  // on the same stage every night and repeats its kids' acts across days, so
  // tell them apart in the name, deterministically: the poster day when the
  // days differ, the day and the printed start when they do not. The note,
  // the log and the review all show it, and the review lets it be edited.
  disambiguateRepeats(sets);

  // Human corrections land here: after every deterministic rule has run, before
  // anything is rendered or validated, so an edited set is checked by the schema
  // exactly like a machine-read one.
  const edits = applyEdits(sets, options.edits ?? []);

  const festival = { name, slug, year, timezone: options.timezone, official_url: officialUrl };
  const yaml = renderYaml(festival, stages, sets, options, sources);

  // The one gatekeeper: reuse src/schema.ts on our own output. Duplicate UIDs
  // (same artist twice on one stage) and every other publishable defect are a
  // hard fail here, before anything is written.
  // Round-trip through the real loader so we validate exactly what a human
  // would later commit, not an in-memory cousin of it.
  const doc = loadFestivalFromString(yaml, `transcription of ${sources.join(', ')}`);

  const log = renderLog(transcriptions, days, festival, sets, edits, options, sources);
  return { doc, yaml, log, sets, edits, festival, stages };
}

// ---------------------------------------------------------------------------
// YAML rendering
// ---------------------------------------------------------------------------

/** Double-quoted YAML scalar. JSON string syntax is valid YAML. */
function q(value: string): string {
  return JSON.stringify(value);
}

function renderYaml(
  festival: { name: string; slug: string; year: number; timezone: string; official_url: string },
  stages: { id: string; name: string }[],
  sets: BuiltSet[],
  options: TranscriptionOptions,
  sources: string[],
): string {
  const verified = options.verified === true;
  const lines: string[] = [];
  lines.push(`# ${festival.name} ${festival.year} — machine transcription of the schedule poster(s).`);
  if (sources.length > 0) {
    lines.push('#');
    lines.push('# Source images:');
    for (const s of sources) lines.push(`#   ${s}`);
  }
  lines.push('#');
  if (verified) {
    lines.push('# verified: true — a human checked every set against the source image above and');
    lines.push('# confirmed it. Corrections made on review are listed in the TRANSCRIPTION log');
    lines.push('# next to this file.');
  } else {
    lines.push('# verified: false — NOT reviewed by a human yet. Ingest is a vision task;');
    lines.push('# review every set against the source image (see the TRANSCRIPTION log next');
    lines.push('# to this file), then set verified: true to authorize publishing.');
  }
  lines.push('');
  lines.push(`verified: ${verified}`);
  lines.push('');
  lines.push('# PERMANENT — decides the URL family: owner editions live at /<slug>-<year>/, fan editions at');
  lines.push('# /fan/<slug>-<year>/ (docs/adr/0001-fan-namespace-prefix.md). Never changes after first publish.');
  lines.push(`namespace: ${options.namespace}`);
  lines.push('');
  lines.push('festival:');
  lines.push(`  name: ${q(festival.name)}`);
  lines.push(`  slug: ${q(festival.slug)}     # PERMANENT — appears in every subscription URL`);
  lines.push(`  year: ${festival.year}`);
  lines.push(`  timezone: ${q(festival.timezone)}${options.timezoneAssumed ? '   # ASSUMED — confirm before publish' : ''}`);
  lines.push(`  official_url: ${q(festival.official_url)}${festival.official_url ? '   # from the poster — unverified' : ''}`);
  lines.push('');
  lines.push('stages:');
  for (const stage of stages) {
    lines.push(`  - id: ${q(stage.id)}     # PERMANENT url slug — never change after publish`);
    lines.push(`    name: ${q(stage.name)}`);
  }
  lines.push('');
  lines.push('sets:');
  let currentDay = '';
  for (const set of sets) {
    if (set.posterDate !== currentDay) {
      currentDay = set.posterDate;
      lines.push(`  # ═══ ${currentDay} ═══`);
    }
    lines.push(`  - stage: ${q(set.stage)}`);
    lines.push(`    artist: ${q(set.artist)}`);
    lines.push(`    raw: ${q(set.raw)}`);
    lines.push(`    start: ${q(set.start)}`);
    lines.push(`    end: ${q(set.end)}${set.crossesMidnight ? '     # shifted: crosses midnight to the next calendar date' : ''}`);
    lines.push(`    end_inferred: ${set.end_inferred}`);
    if (set.notes) lines.push(`    notes: ${q(set.notes)}`);
  }
  lines.push('');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// TRANSCRIPTION log rendering
// ---------------------------------------------------------------------------

function renderLog(
  transcriptions: RawTranscription[],
  days: RawDay[],
  festival: { name: string; slug: string; year: number; timezone: string; official_url: string },
  sets: BuiltSet[],
  edits: AppliedEdit[],
  options: TranscriptionOptions,
  sources: string[],
): string {
  const L: string[] = [];
  L.push(`# Transcription log — ${festival.name} ${festival.year}`);
  L.push('');
  L.push(
    options.verified === true
      ? 'Machine transcription, checked set by set against the source image by a human.'
      : 'Machine transcription — NOT yet human-verified.',
  );
  if (sources.length > 0) {
    L.push('');
    L.push(`Source images: ${sources.map((s) => `\`${s}\``).join(', ')}.`);
  }
  L.push('');
  L.push('---');
  L.push('');
  L.push('## Verbatim transcription');
  L.push('');
  L.push('Times are exactly as printed. `CLOSE` is reproduced literally — it is not a time.');
  for (const day of days) {
    L.push('');
    L.push(`### ${day.header}`);
    for (const stage of day.stages) {
      L.push('');
      L.push(`**${stage.name}**`);
      L.push('```');
      const width = Math.max(...stage.sets.map((s) => (s.afters ? `AFTERS: ${s.artist}` : s.artist).length)) + 3;
      for (const set of stage.sets) {
        const label = set.afters ? `AFTERS: ${set.artist}` : set.artist;
        const annotation = set.annotations?.length ? `  ${set.annotations.join(' ')}` : '';
        L.push(`${label.padEnd(width)}${set.time}${annotation}`);
      }
      L.push('```');
    }
  }

  const perDay = new Map<string, number>();
  for (const set of sets) perDay.set(set.posterDate, (perDay.get(set.posterDate) ?? 0) + 1);
  L.push('');
  L.push(
    `**Totals:** ${[...perDay.entries()].map(([d, n]) => `${n} on ${d}`).join(' + ')} = **${sets.length} sets**.`,
  );
  // Every correction a human made on review, so the machine's reading and the
  // human's disagreement are both on the record next to the published YAML.
  L.push('');
  L.push('---');
  L.push('');
  L.push('## Corrections made on review');
  L.push('');
  if (edits.length === 0) {
    L.push('None — every set is exactly as the machine read it.');
  } else {
    L.push('| Stage | Artist | Field | Machine read | Corrected to |');
    L.push('|---|---|---|---|---|');
    for (const e of edits) L.push(`| ${e.stage} | ${e.artist} | ${e.field} | ${e.from} | ${e.to} |`);
  }

  L.push('');
  L.push('---');
  L.push('');
  L.push('## Ambiguities — every one of these needs a human decision before publish');
  let n = 0;

  // 1. Inferred end times.
  const inferred = sets.filter((s) => s.end_inferred);
  if (inferred.length > 0) {
    n += 1;
    L.push('');
    L.push(`### ${n}. ${inferred.length} set${inferred.length === 1 ? ' has' : 's have'} no printed end time (\`CLOSE\`, or a start alone)`);
    L.push('');
    L.push('Each is resolved to **start + 60 minutes**, marked `end_inferred: true`, and the');
    L.push('subscriber-visible event description will say the end time is assumed to be one');
    L.push('hour after the start. If a real curfew or club close time surfaces, correct the');
    L.push('ends in the YAML and rebuild.');
    L.push('');
    L.push('| Stage | Artist | Printed | Assumed end |');
    L.push('|---|---|---|---|');
    for (const s of inferred) {
      const nextDay = s.end.slice(0, 10) !== s.posterDate ? ` (**${s.end.slice(0, 10)}** — next day)` : '';
      L.push(`| ${s.stage} | ${s.artist} | ${s.printedTime} | ${s.end.slice(11, 16)}${nextDay} |`);
    }
  }

  // 2. Post-midnight shifts.
  const shifted = sets.filter((s) => s.start.slice(0, 10) !== s.posterDate || s.end.slice(0, 10) !== s.posterDate);
  if (shifted.length > 0) {
    n += 1;
    L.push('');
    L.push(`### ${n}. Post-midnight times shifted to the next calendar date`);
    L.push('');
    for (const s of shifted) {
      L.push(`- ${s.artist} (${s.stage}): printed ${s.printedTime} under ${s.posterDate}, resolved ${s.start} → ${s.end}.`);
    }
  }

  // 3. Casing disclaimer — always applies to poster transcription.
  n += 1;
  L.push('');
  L.push(`### ${n}. Artist casing cannot be derived from this source`);
  L.push('');
  L.push('Poster casing is preserved exactly as printed (typically all-uppercase), because');
  L.push('the poster carries no information about official stylization. Correct casing');
  L.push('against the official lineup page if wanted — UID normalization lowercases before');
  L.push('hashing, so casing fixes are display-only and orphan no subscriber events.');

  // 4. Combined AFTERS billings.
  const combined = sets.filter((s) => s.raw.startsWith('AFTERS / ') && s.artist.includes(' + '));
  if (combined.length > 0) {
    n += 1;
    L.push('');
    L.push(`### ${n}. Combined AFTERS billings kept as one event`);
    L.push('');
    L.push('The poster presents one continuous time block, so splitting the acts would');
    L.push('invent start times that are not printed anywhere:');
    L.push('');
    for (const s of combined) L.push(`- ${s.stage}: ${s.raw}`);
  }

  // 5. Artists appearing more than once (different stages ⇒ distinct UIDs).
  const byArtist = new Map<string, BuiltSet[]>();
  for (const s of sets) {
    const key = normalizeArtist(s.artist);
    (byArtist.get(key) ?? byArtist.set(key, []).get(key)!).push(s);
  }
  const repeats = [...byArtist.values()].filter((g) => g.length > 1);
  if (repeats.length > 0) {
    n += 1;
    L.push('');
    L.push(`### ${n}. Artists billed more than once`);
    L.push('');
    L.push('Each appearance is a separate event with a distinct UID (stage id is part of');
    L.push('the UID). Verify against the poster that these are genuinely repeat bookings,');
    L.push('not misreads:');
    L.push('');
    for (const group of repeats) {
      L.push(`- ${group[0]!.artist}: ${group.map((s) => `${s.stage} ${s.start}`).join(', ')}`);
    }
  }

  // 5b. Repeats on one stage, told apart in the name.
  const suffixed = sets.filter((s) => s.printedArtist !== undefined);
  if (suffixed.length > 0) {
    n += 1;
    L.push('');
    L.push(`### ${n}. Repeat bookings on one stage, told apart in the name`);
    L.push('');
    L.push('UID is sha1(slug + year + stage + normalized artist) and excludes the start time');
    L.push('(README, the known limitation), so the same act twice on one stage would collapse');
    L.push('into one event. Each of these carries the day — or the day and printed start — in');
    L.push('its name so every appearance is its own event:');
    L.push('');
    for (const s of suffixed) {
      L.push(`- ${s.printedArtist} → ${s.artist} (${s.stage}, ${s.start})`);
    }
  }

  // 6. Timezone assumption.
  if (options.timezoneAssumed) {
    n += 1;
    L.push('');
    L.push(`### ${n}. Timezone was assumed`);
    L.push('');
    L.push(`\`${festival.timezone}\` was NOT read from the poster — it is a default. Confirm the`);
    L.push('festival city before publish; every start/end time depends on it.');
  }

  // 7. Official URL provenance.
  if (festival.official_url) {
    n += 1;
    L.push('');
    L.push(`### ${n}. Official URL not verified`);
    L.push('');
    L.push(`\`${festival.official_url}\` is derived from the poster footer (normalized to a`);
    L.push('lowercase https URL). The link has not been fetched — confirm before publish.');
  }

  // 8. Model observations, verbatim.
  const observations = transcriptions.flatMap((t) => t.observations ?? []);
  if (observations.length > 0) {
    n += 1;
    L.push('');
    L.push(`### ${n}. Transcriber observations (verbatim from the vision model)`);
    L.push('');
    for (const o of observations) L.push(`- ${o}`);
  }

  L.push('');
  return L.join('\n');
}
