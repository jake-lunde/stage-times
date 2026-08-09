/**
 * Stage Times — deterministic build.
 *
 * Reads `data/<festival-slug>-<year>.yaml`, writes:
 *   dist/<festival-slug>-<year>/<stage-slug>.ics
 *   dist/<festival-slug>-<year>/all.ics
 *   dist/feeds.json          (machine-readable manifest for the page builder)
 *
 * Given identical YAML and identical committed state, output is byte-identical.
 * There is no clock read, no randomness, no network call and no model anywhere in
 * this path. That is what makes the golden-file test and CI diffs meaningful.
 *
 * HTML is NOT generated here. If `src/pages.ts` exists and exports
 * `renderPages(manifest, outDir)`, it is invoked after the feeds are written.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadFestival,
  normalizeArtist,
  type FestivalDoc,
  type SetEntry,
  type Stage,
  type WallTime,
} from './schema.js';
import {
  eventContentHash,
  makeEventContent,
  renderCalendar,
  type EventContent,
  type RenderedEvent,
} from './ics.js';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, '..');

export const ALL_STAGES_LABEL = 'All Stages';

// ---------------------------------------------------------------------------
// Committed state
// ---------------------------------------------------------------------------

export interface SequenceEntry {
  sequence: number;
  hash: string;
  /** `YYYYMMDDTHHMMSSZ` */
  lastModified: string;
}

export interface SequencesFile {
  $comment?: string | string[];
  events: Record<string, SequenceEntry>;
}

export interface PublishedFestival {
  slug: string;
  year: number;
  stages: string[];
}

export interface PublishedFile {
  $comment?: string | string[];
  /** Revision stamp for this publish, `YYYYMMDDTHHMMSSZ`. Bump when the YAML changes. */
  publishedAt: string;
  /** Which festival key `npm run build` builds when no argument is given. */
  default: string;
  festivals: Record<string, PublishedFestival>;
}

/** State handed to the pure builder. Never read from the clock. */
export interface BuildState {
  publishedAt: string;
  sequences: Record<string, SequenceEntry>;
}

const STAMP_RE = /^\d{8}T\d{6}Z$/;

export function assertStamp(stamp: string, where: string): string {
  if (!STAMP_RE.test(stamp)) {
    throw new Error(
      `${where}: "${stamp}" is not a UTC iCalendar stamp of the form YYYYMMDDTHHMMSSZ. ` +
        `This value becomes DTSTAMP/LAST-MODIFIED in every published event and must come from committed state, not the clock.`,
    );
  }
  return stamp;
}

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

export interface DaySpan {
  days: number;
  first: string;
  last: string;
  label: string;
}

export interface StageManifest {
  id: string;
  name: string;
  description: string;
  setCount: number;
  dayspan: DaySpan;
  firstSet: string;
  lastSet: string;
  lastSetEnd: string;
  /** The artist closing each day on this stage, in day order, deduped — the "headliner preview". */
  headliners: string[];
  icsPath: string;
}

export interface Manifest {
  festival: {
    name: string;
    slug: string;
    year: number;
    timezone: string;
    officialUrl: string;
    key: string;
    basePath: string;
  };
  stages: StageManifest[];
  all: {
    id: string;
    name: string;
    setCount: number;
    dayspan: DaySpan;
    icsPath: string;
  };
  allSetCount: number;
  /** From committed state (publishedAt), never the wall clock. */
  lastUpdated: string;
  /** Mirrors the YAML `verified:` flag so the pages can label an unchecked preview. */
  verified: boolean;
}

// ---------------------------------------------------------------------------
// Pure build
// ---------------------------------------------------------------------------

export interface BuildResult {
  /** Relative POSIX path -> file contents. */
  files: Map<string, string>;
  manifest: Manifest;
  nextSequences: Record<string, SequenceEntry>;
  /** UIDs whose content hash moved this build. */
  changedUids: string[];
  /** UIDs seen for the first time this build. */
  newUids: string[];
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

function isoDate(w: WallTime): string {
  return `${w.year}-${String(w.month).padStart(2, '0')}-${String(w.day).padStart(2, '0')}`;
}

function isoLocal(w: WallTime): string {
  const p2 = (n: number) => String(n).padStart(2, '0');
  return `${isoDate(w)}T${p2(w.hour)}:${p2(w.minute)}:${p2(w.second)}`;
}

function dayLabel(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const wd = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]!;
  return `${wd} ${d} ${MONTHS[m - 1]!}`;
}

function daySpanOf(sets: SetEntry[]): DaySpan {
  const dates = [...new Set(sets.map((s) => isoDate(s.start)))].sort();
  const first = dates[0] ?? '';
  const last = dates[dates.length - 1] ?? '';
  if (!first) return { days: 0, first: '', last: '', label: '' };
  const year = first.slice(0, 4);
  const label =
    first === last ? `${dayLabel(first)} ${year}` : `${dayLabel(first)} – ${dayLabel(last)} ${year}`;
  return { days: dates.length, first, last, label };
}

/** Deterministic event ordering: start time, then normalized artist, then UID. */
function sortEvents(a: { content: EventContent; set: SetEntry }, b: { content: EventContent; set: SetEntry }): number {
  if (a.content.dtstart !== b.content.dtstart) return a.content.dtstart < b.content.dtstart ? -1 : 1;
  const an = normalizeArtist(a.set.artist);
  const bn = normalizeArtist(b.set.artist);
  if (an !== bn) return an < bn ? -1 : 1;
  return a.content.uid < b.content.uid ? -1 : a.content.uid > b.content.uid ? 1 : 0;
}

/**
 * Build every feed and the manifest. Pure: no filesystem, no clock.
 */
export function buildFeeds(doc: FestivalDoc, state: BuildState): BuildResult {
  assertStamp(state.publishedAt, 'state/published.json publishedAt');

  const { festival, stages, sets } = doc;
  const key = `${festival.slug}-${festival.year}`;
  const basePath = `/${key}`;

  const stageById = new Map<string, Stage>(stages.map((s) => [s.id, s]));

  // Resolve content + sequence for every set, in YAML order first.
  const nextSequences: Record<string, SequenceEntry> = { ...state.sequences };
  const changedUids: string[] = [];
  const newUids: string[] = [];

  const prepared = sets.map((set) => {
    const stage = stageById.get(set.stage)!;
    const content = makeEventContent(festival, stage, set);
    const hash = eventContentHash(content);
    const prior = state.sequences[content.uid];

    let entry: SequenceEntry;
    if (!prior) {
      entry = { sequence: 0, hash, lastModified: state.publishedAt };
      newUids.push(content.uid);
    } else if (prior.hash !== hash) {
      entry = { sequence: prior.sequence + 1, hash, lastModified: state.publishedAt };
      changedUids.push(content.uid);
    } else {
      entry = { sequence: prior.sequence, hash: prior.hash, lastModified: prior.lastModified };
    }
    nextSequences[content.uid] = entry;

    const rendered: RenderedEvent = {
      ...content,
      sequence: entry.sequence,
      // DTSTAMP and LAST-MODIFIED both come from committed state. DTSTAMP is
      // nominally "when this iCalendar object instance was created", but a
      // wall-clock read there would make every build byte-different, so we pin it
      // to the same committed revision stamp as LAST-MODIFIED.
      dtstamp: entry.lastModified,
      lastModified: entry.lastModified,
    };
    return { set, stage, content, rendered };
  });

  const files = new Map<string, string>();
  const stageManifests: StageManifest[] = [];

  for (const stage of stages) {
    const mine = prepared.filter((p) => p.set.stage === stage.id).sort(sortEvents);
    const icsPath = `${basePath}/${stage.id}.ics`;
    files.set(
      `${key}/${stage.id}.ics`,
      renderCalendar({ festival, stageName: stage.name, events: mine.map((p) => p.rendered) }),
    );
    const mySets = mine.map((p) => p.set);
    const starts = mySets.map((s) => isoLocal(s.start)).sort();
    const ends = mySets.map((s) => isoLocal(s.end)).sort();

    // Headliner preview: the artist who starts last on each calendar day, in day
    // order. `mine` is already sorted by start, so the last entry per date wins.
    const closerByDate = new Map<string, string>();
    for (const p of mine) closerByDate.set(isoDate(p.set.start), p.set.artist);
    const headliners = [...new Set([...closerByDate.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([, artist]) => artist))];

    stageManifests.push({
      id: stage.id,
      name: stage.name,
      description: stage.description,
      setCount: mySets.length,
      dayspan: daySpanOf(mySets),
      firstSet: starts[0] ?? '',
      lastSet: starts[starts.length - 1] ?? '',
      lastSetEnd: ends[ends.length - 1] ?? '',
      headliners,
      icsPath,
    });
  }

  const allSorted = prepared.slice().sort(sortEvents);
  files.set(
    `${key}/all.ics`,
    renderCalendar({ festival, stageName: ALL_STAGES_LABEL, events: allSorted.map((p) => p.rendered) }),
  );

  const manifest: Manifest = {
    festival: {
      name: festival.name,
      slug: festival.slug,
      year: festival.year,
      timezone: festival.timezone,
      officialUrl: festival.official_url,
      key,
      basePath,
    },
    stages: stageManifests,
    all: {
      id: 'all',
      name: ALL_STAGES_LABEL,
      setCount: allSorted.length,
      dayspan: daySpanOf(allSorted.map((p) => p.set)),
      icsPath: `${basePath}/all.ics`,
    },
    allSetCount: allSorted.length,
    lastUpdated: state.publishedAt,
    verified: doc.verified,
  };

  files.set('feeds.json', stableJson(manifest));

  return { files, manifest, nextSequences, changedUids, newUids };
}

// ---------------------------------------------------------------------------
// Gate 4 — URL stability
// ---------------------------------------------------------------------------

/**
 * A stage slug that has ever been published is a URL somebody's calendar client
 * polls forever. If it vanishes from the YAML that is a rename or a deletion, and
 * it needs a human decision, not a silent 404.
 */
export function assertPublishedSlugsPresent(published: PublishedFile, key: string, doc: FestivalDoc): void {
  const record = published.festivals[key];
  if (!record) return; // nothing published for this festival yet
  const current = new Set(doc.stages.map((s) => s.id));
  const missing = record.stages.filter((id) => !current.has(id));
  if (missing.length === 0) return;
  throw new Error(
    [
      '',
      '  ███ PUBLISHED FEED URL DISAPPEARED — BUILD REFUSED ███',
      '',
      `  These stage slugs are recorded as published in state/published.json under "${key}"`,
      `  but no longer exist in ${doc.sourcePath}:`,
      '',
      ...missing.map((id) => `      https://stagetimes.app/${key}/${id}.ics   (stage id "${id}")`),
      '',
      '  Every subscriber who ever tapped those links still polls those exact URLs.',
      '  There is no redirect a calendar client will follow for a subscription, so',
      '  removing or renaming one is a silent, permanent break for those people.',
      '',
      '  If the festival RENAMED a stage: keep the `id` and change only the `name`.',
      '  If the stage is genuinely GONE: keep publishing the id with its final sets,',
      '  or decide deliberately to break those subscribers and remove the id from',
      '  state/published.json in the same commit, with a note saying why.',
      '',
    ].join('\n'),
  );
}

// ---------------------------------------------------------------------------
// Filesystem helpers
// ---------------------------------------------------------------------------

/** JSON with 2-space indent and a trailing newline. Key order is insertion order. */
export function stableJson(value: unknown): string {
  return JSON.stringify(value, null, 2) + '\n';
}

function sortObjectKeys<T>(obj: Record<string, T>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const k of Object.keys(obj).sort()) out[k] = obj[k]!;
  return out;
}

export function readPublished(path: string): PublishedFile {
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as PublishedFile;
  assertStamp(parsed.publishedAt, `${path} publishedAt`);
  return parsed;
}

export function readSequences(path: string): SequencesFile {
  if (!existsSync(path)) return { events: {} };
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as SequencesFile;
  return { $comment: parsed.$comment, events: parsed.events ?? {} };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export interface RunOptions {
  dataFile?: string;
  outDir?: string;
  repoRoot?: string;
  /** Skip writing state back (used by tests). */
  dryState?: boolean;
  /**
   * Refuse to build a schedule whose `verified:` flag is not true.
   *
   * Ingest is a vision task. Everything downstream of it is deterministic and
   * tested, which makes it easy to forget that the numbers at the very top of
   * the pipeline were read off a JPEG by a machine. This is the one gate that
   * guards that seam, so it is on for production and off for previews.
   */
  production?: boolean;
  log?: (msg: string) => void;
}

export class UnverifiedScheduleError extends Error {
  constructor(doc: { sourcePath: string }) {
    super(
      `Refusing to publish ${doc.sourcePath} — \`verified: true\` is not set.\n\n` +
        `  This schedule was transcribed from images and has not been signed off by a\n` +
        `  human. A wrong set time in a published feed is silent and unfixable for every\n` +
        `  subscriber who already tapped the URL.\n\n` +
        `  Check the data against the source images (see source/TRANSCRIPTION.md for the\n` +
        `  list of known ambiguities), then set \`verified: true\` at the top of the YAML.\n` +
        `  To build a preview without publishing, drop the --production flag.`,
    );
    this.name = 'UnverifiedScheduleError';
  }
}

export async function run(options: RunOptions = {}): Promise<BuildResult> {
  const root = options.repoRoot ?? REPO_ROOT;
  const log = options.log ?? ((m: string) => process.stdout.write(m + '\n'));
  const publishedPath = join(root, 'state', 'published.json');
  const sequencesPath = join(root, 'state', 'sequences.json');

  const published = readPublished(publishedPath);
  // With no explicit file, build the festival named as `default` in published.json.
  const dataFile = options.dataFile ?? join(root, 'data', `${published.default}.yaml`);
  const doc = loadFestival(dataFile);
  const docKey = `${doc.festival.slug}-${doc.festival.year}`;

  // Ingest gate — before anything is written.
  if (options.production && !doc.verified) throw new UnverifiedScheduleError(doc);
  if (!doc.verified) {
    log(`  ⚠ ${docKey} is UNVERIFIED — preview only, will not deploy to production.`);
  }

  // Gate 4 — before anything is written.
  assertPublishedSlugsPresent(published, docKey, doc);

  const sequencesFile = readSequences(sequencesPath);
  const publishedAt = process.env['STAGE_TIMES_PUBLISHED_AT'] ?? published.publishedAt;
  assertStamp(publishedAt, 'publishedAt');

  const result = buildFeeds(doc, { publishedAt, sequences: sequencesFile.events });

  if (result.changedUids.length > 0) {
    const priorStamps = Object.values(sequencesFile.events).map((e) => e.lastModified);
    const newestPrior = priorStamps.sort().at(-1);
    if (newestPrior && publishedAt <= newestPrior) {
      process.stderr.write(
        `WARNING: ${result.changedUids.length} event(s) changed content but publishedAt (${publishedAt}) is not newer ` +
          `than the newest stored LAST-MODIFIED (${newestPrior}).\n` +
          `         SEQUENCE still advances so clients will take the update, but bump publishedAt in state/published.json\n` +
          `         so LAST-MODIFIED reflects this revision.\n`,
      );
    }
  }

  const outDir = options.outDir ?? join(root, 'dist');
  rmSync(outDir, { recursive: true, force: true });
  for (const [rel, contents] of [...result.files.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const target = join(outDir, rel);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, contents, 'utf8');
    log(`  wrote ${rel} (${Buffer.byteLength(contents, 'utf8')} bytes)`);
  }

  if (!options.dryState) {
    // Sequence entries are never pruned: if an act is dropped and later re-added,
    // its SEQUENCE must not go backwards or clients will ignore the re-add.
    writeFileSync(
      sequencesPath,
      stableJson({
        $comment: sequencesFile.$comment ?? SEQUENCES_COMMENT,
        events: sortObjectKeys(result.nextSequences),
      }),
      'utf8',
    );

    const record = published.festivals[docKey];
    const currentStages = doc.stages.map((s) => s.id);
    const merged = record
      ? [...new Set([...record.stages, ...currentStages])].sort()
      : currentStages.slice().sort();
    published.festivals[docKey] = { slug: doc.festival.slug, year: doc.festival.year, stages: merged };
    writeFileSync(publishedPath, stableJson(published), 'utf8');
  }

  // Optional page rendering, owned by someone else. Guarded so the feed build
  // still works before src/pages.ts exists.
  const pagesSrc = join(HERE, 'pages.ts');
  if (existsSync(pagesSrc)) {
    // Indirect specifier on purpose: src/pages.ts is owned by the page builder and
    // may not exist yet, and a static specifier would fail typecheck until it does.
    const spec = './pages.js';
    const mod = (await import(spec)) as { renderPages?: (m: Manifest, out: string) => unknown };
    if (typeof mod.renderPages === 'function') {
      await mod.renderPages(result.manifest, outDir);
      log('  rendered pages via src/pages.ts');
    } else {
      log('  src/pages.ts exists but exports no renderPages(manifest, outDir) — skipping HTML');
    }
  } else {
    log('  src/pages.ts not present — feeds only, no HTML');
  }

  log(
    `Built ${docKey}: ${result.manifest.stages.length} stage feeds + all.ics, ` +
      `${result.manifest.allSetCount} sets, lastUpdated ${result.manifest.lastUpdated}` +
      (result.newUids.length ? `, ${result.newUids.length} new event(s)` : '') +
      (result.changedUids.length ? `, ${result.changedUids.length} changed event(s)` : ''),
  );
  return result;
}

export const SEQUENCES_COMMENT = [
  'COMMITTED STATE — do not hand-edit casually and never delete.',
  'Keyed by UID. `sequence` advances only when `hash` (the subscriber-visible content of the event) changes.',
  'Clients ignore an update whose SEQUENCE has not advanced, so losing this file means published edits stop propagating.',
  'lastModified is the publishedAt stamp of the build that last changed the event; it becomes DTSTAMP and LAST-MODIFIED.',
];

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const args = process.argv.slice(2);
  // --dry-state builds feeds without touching state/. Use it when building a test
  // fixture (e.g. data/dst-check-2026.yaml) so its UIDs never land in the
  // committed sequence ledger for the real festival.
  const dryState = args.includes('--dry-state');
  // --production refuses to build an unverified schedule. Vercel production
  // deploys set VERCEL_ENV=production, so the gate applies there without anyone
  // having to remember the flag; preview deploys build freely.
  const production = args.includes('--production') || process.env['VERCEL_ENV'] === 'production';
  const arg = args.find((a) => !a.startsWith('--'));
  run({ dataFile: arg ? resolve(arg) : undefined, dryState, production }).catch((err: unknown) => {
    process.stderr.write((err instanceof Error ? err.message : String(err)) + '\n');
    process.exitCode = 1;
  });
}
