/**
 * Stage Times — deterministic build.
 *
 * Reads every edition under `data/` (`data/**\/*.yaml`) and writes, per edition,
 * into the namespace its YAML declares (ADR-0001):
 *   dist/<festival-slug>-<year>/<stage-slug>.ics        owner editions
 *   dist/<festival-slug>-<year>/all.ics
 *   dist/fan/<festival-slug>-<year>/<stage-slug>.ics    fan editions
 *   dist/fan/<festival-slug>-<year>/all.ics
 *   dist/feeds.json          (machine-readable manifest: every edition, with its
 *                             namespace, listed and blocked flags)
 *
 * Given identical YAML and identical committed state, output is byte-identical.
 * There is no clock read, no randomness, no network call and no model anywhere in
 * this path. That is what makes the golden-file test and CI diffs meaningful.
 *
 * A blocked edition (state/published.json `blocked: true`) still builds: every
 * feed URL it ever served emits a valid calendar with zero events and its
 * original calendar name, so no subscriber ever sees a 404.
 *
 * HTML is NOT generated here. If `src/pages.ts` exists and exports
 * `renderSitePages(site, outDir)`, it is invoked after the feeds are written.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadFestival,
  normalizeArtist,
  type FestivalDoc,
  type Namespace,
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

/** URL prefix for the fan namespace: `/fan/<slug>-<year>/`. Frozen by ADR-0001. */
export const FAN_PREFIX = 'fan';

// ---------------------------------------------------------------------------
// Edition identity
// ---------------------------------------------------------------------------

/** `<festival-slug>-<year>` — the edition key. The same key can exist once per namespace. */
export function editionKey(doc: Pick<FestivalDoc, 'festival'>): string {
  return `${doc.festival.slug}-${doc.festival.year}`;
}

/**
 * The edition's URL path without the leading slash: `<key>` for owner editions,
 * `fan/<key>` for fan editions. This is the key into both committed state files
 * and the directory under dist/. It is unique across namespaces.
 */
export function editionPath(namespace: Namespace, key: string): string {
  return namespace === 'fan' ? `${FAN_PREFIX}/${key}` : key;
}

export function editionPathOf(doc: Pick<FestivalDoc, 'festival' | 'namespace'>): string {
  return editionPath(doc.namespace, editionKey(doc));
}

// ---------------------------------------------------------------------------
// Committed state
// ---------------------------------------------------------------------------

export interface SequenceEntry {
  sequence: number;
  hash: string;
  /** `YYYYMMDDTHHMMSSZ` */
  lastModified: string;
}

/** One edition's ledger: UID -> entry. */
export type SequenceLedger = Record<string, SequenceEntry>;

export interface SequencesFile {
  $comment?: string | string[];
  /** Keyed by edition path (`<key>` or `fan/<key>`), then by UID. */
  editions: Record<string, SequenceLedger>;
}

/**
 * Who uploaded an edition, written by the publisher at confirm (src/publisher.ts).
 *
 * Its presence is what "uploader-verified" means: a human checked this edition
 * against the image they uploaded. The build never writes it, never reads it,
 * and never drops it — holding the update-link secret is what makes someone an
 * edition's uploader, and losing this record would orphan their edition.
 *
 * Only hashes are kept. The repository is public: the secret is shown once and
 * the contact address reaches the owner through a notification, not a commit.
 */
export interface UploaderRecord {
  /** SHA-256 of the update-link secret. */
  secretHash: string;
  /** SHA-256 of the lowercased contact address. */
  addressHash: string;
  /** The publish stamp of the confirm that created the edition. */
  verifiedAt: string;
  /** Content hash of the (first) stored source image the edition was read from. */
  image: string;
  /** Every stored source image, in the order given, when there was more than one. */
  images?: string[];
  /**
   * The publish stamp of the latest correction through the update link, if any.
   * `image`/`images` then name the images that correction was read from.
   */
  correctedAt?: string;
}

export interface PublishedEdition {
  slug: string;
  year: number;
  /** Recorded at first publish. The build refuses a YAML whose namespace disagrees. */
  namespace: Namespace;
  /** The owner has approved this edition for the homepage. Always a human act. */
  listed: boolean;
  /**
   * Removed at a rights holder's request, or by the uploader's self-removal.
   * Feeds keep serving, empty; the page says the edition was removed. Never
   * deleted, never listed. Unblocking is a revert of the commit that set this.
   */
  blocked: boolean;
  /**
   * On a blocked edition only: the edition path its set times moved to. Its
   * page then points there instead of saying only that it was taken down.
   * The feeds stay empty either way; a calendar cannot be moved.
   */
  movedTo?: string;
  /** Every stage slug ever served under this edition's path. Append-only. */
  stages: string[];
  /** Present on an edition a fan uploaded and confirmed. Never set by the build. */
  uploader?: UploaderRecord;
}

export interface PublishedFile {
  $comment?: string | string[];
  /** Revision stamp for this publish, `YYYYMMDDTHHMMSSZ`. Bump when any YAML changes. */
  publishedAt: string;
  /** Keyed by edition path (`<key>` or `fan/<key>`). */
  editions: Record<string, PublishedEdition>;
}

/** Per-edition state handed to the pure builder. Never read from the clock. */
export interface BuildState {
  publishedAt: string;
  /** This edition's UID -> sequence ledger. */
  sequences: SequenceLedger;
}

/** The two owner-controlled flags on an edition, from committed state. */
export interface EditionFlags {
  listed: boolean;
  blocked: boolean;
}

export const UNPUBLISHED_FLAGS: EditionFlags = { listed: false, blocked: false };

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
  /** The weekend this stage's feed covers, on an edition that runs more than one. Display only. */
  weekend?: string;
  setCount: number;
  dayspan: DaySpan;
  firstSet: string;
  lastSet: string;
  lastSetEnd: string;
  /** The artist closing each day on this stage, in day order, deduped — the "headliner preview". */
  headliners: string[];
  /** Every set on this stage in start order, local wall times, for the card art. */
  sets: { artist: string; start: string; end: string }[];
  icsPath: string;
}

/** One weekend of an edition that runs more than one: its name, its days, and what it holds. */
export interface WeekendManifest {
  name: string;
  dayspan: DaySpan;
  stageCount: number;
  setCount: number;
}

/** One edition's manifest. */
export interface Manifest {
  festival: {
    name: string;
    slug: string;
    year: number;
    timezone: string;
    officialUrl: string;
    /** Display only, for the homepage card's eyebrow. Absent when the YAML has none. */
    city?: string;
    /** `<slug>-<year>` */
    key: string;
    /** `/<key>` or `/fan/<key>` — the edition's URL path. */
    basePath: string;
  };
  namespace: Namespace;
  /**
   * Approved for the homepage. A blocked edition is never listed, so this is
   * `false` whenever `blocked` is, whatever committed state says — the block
   * edit is one line and the listing survives a revert.
   */
  listed: boolean;
  blocked: boolean;
  /** A blocked edition whose set times moved: the edition they moved to, for its page. */
  movedTo?: { name: string; year: number; basePath: string };
  stages: StageManifest[];
  /**
   * The weekends, in date order, when the edition runs more than one (ACL,
   * Coachella). Every stage then names its weekend, and the page picks a
   * weekend before it shows the stages. Absent for one run of days.
   */
  weekends?: WeekendManifest[];
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

/** `dist/feeds.json` — every edition the build produced, sorted by edition path. */
export interface SiteManifest {
  editions: Manifest[];
}

// ---------------------------------------------------------------------------
// Pure build — one edition
// ---------------------------------------------------------------------------

export interface BuildResult {
  /** Relative POSIX path -> file contents. */
  files: Map<string, string>;
  manifest: Manifest;
  nextSequences: SequenceLedger;
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

/** The night a set belongs to: its date, or the day before when it starts before 6 AM. */
export function nightOf(w: WallTime): string {
  if (w.hour >= 6) return isoDate(w);
  const d = new Date(Date.UTC(w.year, w.month - 1, w.day));
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
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

/**
 * What a stage's calendar is called: the stage, and its weekend when the
 * edition runs more than one — a person who adds a stage from both weekends
 * gets two calendars, and they have to read apart in the list.
 */
export function feedLabel(stage: Pick<Stage, 'name' | 'weekend'>): string {
  return stage.weekend ? `${stage.name} (${stage.weekend})` : stage.name;
}

/** How many stages a festival-goer would count: a stage on both weekends is one stage, twice. */
export function stageCountOf(stages: Pick<Stage, 'name'>[]): number {
  return new Set(stages.map((s) => s.name)).size;
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
 * Build every feed and the manifest for one edition. Pure: no filesystem, no clock.
 *
 * With `flags.blocked` the edition's sets are withheld: every stage feed and
 * all.ics render as a valid calendar with zero events and the calendar name
 * intact, the manifest reports zero sets, and the sequence ledger is left exactly
 * as it was so a revert of the block resumes where it left off.
 */
export function buildFeeds(doc: FestivalDoc, state: BuildState, flags: EditionFlags = UNPUBLISHED_FLAGS): BuildResult {
  assertStamp(state.publishedAt, 'state/published.json publishedAt');

  const { festival, stages, sets } = doc;
  const key = editionKey(doc);
  const path = editionPathOf(doc);
  const basePath = `/${path}`;

  const stageById = new Map<string, Stage>(stages.map((s) => [s.id, s]));

  // Resolve content + sequence for every set, in YAML order first.
  const nextSequences: SequenceLedger = { ...state.sequences };
  const changedUids: string[] = [];
  const newUids: string[] = [];

  const published = flags.blocked ? [] : sets;
  const prepared = published.map((set) => {
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
      `${path}/${stage.id}.ics`,
      renderCalendar({ festival, stageName: feedLabel(stage), events: mine.map((p) => p.rendered) }),
    );
    const mySets = mine.map((p) => p.set);
    const starts = mySets.map((s) => isoLocal(s.start)).sort();
    const ends = mySets.map((s) => isoLocal(s.end)).sort();

    // Headliners: the acts the stage bills as its closer each night, from the YAML
    // when the uploader named them, otherwise the set that starts last each night.
    // A night runs until 6 AM — a 1:45 AM set belongs to the night before (owner
    // ruling, 2026-09-21). Night order; blocked editions have no sets and so none.
    const closerByNight = new Map<string, string>();
    for (const p of mine) closerByNight.set(nightOf(p.set.start), p.set.artist);
    const derived = [...new Set([...closerByNight.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([, artist]) => artist))];
    const billed = stage.headliners.filter((h) => mySets.some((s) => s.artist === h));
    const headliners = billed.length > 0 ? billed : derived;

    stageManifests.push({
      id: stage.id,
      name: stage.name,
      description: stage.description,
      ...(stage.weekend ? { weekend: stage.weekend } : {}),
      setCount: mySets.length,
      dayspan: daySpanOf(mySets),
      firstSet: starts[0] ?? '',
      lastSet: starts[starts.length - 1] ?? '',
      lastSetEnd: ends[ends.length - 1] ?? '',
      headliners,
      sets: mySets.map((s) => ({ artist: s.artist, start: isoLocal(s.start), end: isoLocal(s.end) })),
      icsPath,
    });
  }

  // The weekends, in the order the stages name them (the first weekend's
  // stages come first in the YAML), each with the span of its own sets.
  const weekendNames = [...new Set(stages.map((s) => s.weekend).filter((w): w is string => !!w))];
  const weekends: WeekendManifest[] = weekendNames.map((name) => {
    const ids = new Set(stages.filter((s) => s.weekend === name).map((s) => s.id));
    const theirs = prepared.filter((p) => ids.has(p.set.stage)).map((p) => p.set);
    return { name, dayspan: daySpanOf(theirs), stageCount: ids.size, setCount: theirs.length };
  });

  const allSorted = prepared.slice().sort(sortEvents);
  files.set(
    `${path}/all.ics`,
    renderCalendar({ festival, stageName: ALL_STAGES_LABEL, events: allSorted.map((p) => p.rendered) }),
  );

  const manifest: Manifest = {
    festival: {
      name: festival.name,
      slug: festival.slug,
      year: festival.year,
      timezone: festival.timezone,
      officialUrl: festival.official_url,
      ...(festival.city ? { city: festival.city } : {}),
      key,
      basePath,
    },
    namespace: doc.namespace,
    listed: flags.listed && !flags.blocked,
    blocked: flags.blocked,
    stages: stageManifests,
    ...(weekends.length > 0 ? { weekends } : {}),
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

  return { files, manifest, nextSequences, changedUids, newUids };
}

// ---------------------------------------------------------------------------
// Pure build — the whole site
// ---------------------------------------------------------------------------

export interface EditionBuild {
  path: string;
  doc: FestivalDoc;
  result: BuildResult;
}

export interface SiteBuildResult {
  /** Relative POSIX path -> file contents, every edition plus feeds.json. */
  files: Map<string, string>;
  site: SiteManifest;
  editions: EditionBuild[];
  /** The full ledger to write back: every edition, keyed by edition path. */
  nextSequences: Record<string, SequenceLedger>;
  /** published.json with every built edition recorded (stages merged, flags kept). */
  nextPublished: PublishedFile;
}

/**
 * Build every edition into one output tree. Pure: no filesystem, no clock.
 *
 * Runs gate 4 for every edition before producing anything, slices the sequence
 * ledger per edition (UIDs deliberately ignore the namespace, so an owner and a
 * fan edition of the same festival-year can share UIDs without sharing SEQUENCE
 * history), and returns the state files as they should be written back.
 */
export function buildSite(docs: FestivalDoc[], published: PublishedFile, sequences: SequencesFile, publishedAt: string): SiteBuildResult {
  assertStamp(publishedAt, 'publishedAt');

  const sorted = docs.slice().sort((a, b) => (editionPathOf(a) < editionPathOf(b) ? -1 : 1));
  const seen = new Map<string, string>();
  for (const doc of sorted) {
    const path = editionPathOf(doc);
    const prev = seen.get(path);
    if (prev !== undefined) {
      throw new Error(
        `Two editions resolve to the same URL path "/${path}/": ${prev} and ${doc.sourcePath}. ` +
          `An edition is one festival-year in one namespace; give one of them a different slug.`,
      );
    }
    seen.set(path, doc.sourcePath);
  }

  // Gate 4 — before anything is built.
  assertPublishedEditionsPresent(published, sorted);
  for (const doc of sorted) assertPublishedSlugsPresent(published, editionPathOf(doc), doc);

  const files = new Map<string, string>();
  const editions: EditionBuild[] = [];
  const nextSequences: Record<string, SequenceLedger> = {};
  // Ledgers for editions no longer in data/ cannot happen (gate 4 above), but
  // never drop anything from committed state on principle.
  for (const [path, ledger] of Object.entries(sequences.editions)) nextSequences[path] = ledger;

  const nextPublished: PublishedFile = {
    ...published,
    editions: { ...published.editions },
  };

  for (const doc of sorted) {
    const path = editionPathOf(doc);
    const record = published.editions[path];
    const flags: EditionFlags = record ? { listed: record.listed, blocked: record.blocked } : UNPUBLISHED_FLAGS;
    const result = buildFeeds(doc, { publishedAt, sequences: sequences.editions[path] ?? {} }, flags);
    for (const [rel, text] of result.files) files.set(rel, text);
    editions.push({ path, doc, result });
    nextSequences[path] = result.nextSequences;

    const currentStages = doc.stages.map((s) => s.id);
    nextPublished.editions[path] = {
      // Carry forward anything the build does not own — the uploader record the
      // publisher wrote, above all. Dropping it would orphan a fan edition from
      // the only person allowed to correct it.
      ...record,
      slug: doc.festival.slug,
      year: doc.festival.year,
      namespace: doc.namespace,
      listed: flags.listed,
      blocked: flags.blocked,
      stages: record ? [...new Set([...record.stages, ...currentStages])].sort() : currentStages.slice().sort(),
    };
  }
  nextPublished.editions = sortObjectKeys(nextPublished.editions);

  // A blocked edition that moved points at where its set times live now.
  for (const e of editions) {
    const target = published.editions[e.path]?.movedTo;
    if (target === undefined) continue;
    const to = editions.find((x) => x.path === target);
    if (!published.editions[e.path]!.blocked) {
      throw new Error(`state/published.json: editions["${e.path}"].movedTo is set but the edition is not blocked. Only a taken-down edition moves.`);
    }
    if (!to || to.path === e.path || to.result.manifest.blocked) {
      throw new Error(`state/published.json: editions["${e.path}"].movedTo names "${target}", which is not another edition this build publishes unblocked.`);
    }
    const f = to.result.manifest.festival;
    e.result.manifest.movedTo = { name: f.name, year: f.year, basePath: f.basePath };
  }

  const site: SiteManifest = { editions: editions.map((e) => e.result.manifest) };
  files.set('feeds.json', stableJson(site));

  return { files, site, editions, nextSequences, nextPublished };
}

// ---------------------------------------------------------------------------
// Gate 4 — URL stability
// ---------------------------------------------------------------------------

/**
 * A stage slug that has ever been published is a URL somebody's calendar client
 * polls forever. If it vanishes from the YAML that is a rename or a deletion, and
 * it needs a human decision, not a silent 404.
 */
export function assertPublishedSlugsPresent(published: PublishedFile, path: string, doc: FestivalDoc): void {
  const record = published.editions[path];
  if (!record) return; // nothing published for this edition yet
  const current = new Set(doc.stages.map((s) => s.id));
  const missing = record.stages.filter((id) => !current.has(id));
  if (missing.length === 0) return;
  throw new Error(
    [
      '',
      '  ███ PUBLISHED FEED URL DISAPPEARED — BUILD REFUSED ███',
      '',
      `  These stage slugs are recorded as published in state/published.json under "${path}"`,
      `  but no longer exist in ${doc.sourcePath}:`,
      '',
      ...missing.map((id) => `      https://stagetimes.app/${path}/${id}.ics   (stage id "${id}")`),
      '',
      '  Every subscriber who ever tapped those links still polls those exact URLs.',
      '  There is no redirect a calendar client will follow for a subscription, so',
      '  removing or renaming one is a silent, permanent break for those people.',
      '',
      '  If the festival RENAMED a stage: keep the `id` and change only the `name`.',
      '  If the stage is genuinely GONE: keep publishing the id with its final sets,',
      '  or decide deliberately to break those subscribers and remove the id from',
      '  state/published.json in the same commit, with a note saying why.',
      '  If the edition must come down: set `blocked: true` instead (docs/takedown-runbook.md).',
      '',
    ].join('\n'),
  );
}

/**
 * The edition-level half of gate 4. Every edition path recorded in
 * state/published.json must still have a YAML that builds to that path — a
 * deleted data file or a changed `namespace:` would otherwise 404 every feed
 * URL under it, silently.
 */
export function assertPublishedEditionsPresent(published: PublishedFile, docs: FestivalDoc[]): void {
  const byPath = new Map(docs.map((d) => [editionPathOf(d), d]));
  const missing = Object.keys(published.editions).filter((path) => !byPath.has(path));
  if (missing.length === 0) return;
  const lines = [
    '',
    '  ███ PUBLISHED EDITION DISAPPEARED — BUILD REFUSED ███',
    '',
    '  These editions are recorded as published in state/published.json but no YAML',
    '  under data/ builds to their URL path:',
    '',
  ];
  for (const path of missing) {
    const record = published.editions[path]!;
    const elsewhere = docs.find((d) => editionKey(d) === `${record.slug}-${record.year}`);
    lines.push(`      https://stagetimes.app/${path}/   (stages: ${record.stages.join(', ') || 'none'})`);
    if (elsewhere) {
      lines.push(
        `        ${elsewhere.sourcePath} declares \`namespace: ${elsewhere.namespace}\` but this edition was published as \`${record.namespace}\`.`,
        '        An edition never moves between namespaces (docs/adr/0001-fan-namespace-prefix.md).',
      );
    }
  }
  lines.push(
    '',
    '  Every feed URL under those paths is still being polled by everyone who ever',
    '  subscribed. Deleting the YAML or changing its namespace is a silent, permanent',
    '  break for them. To take an edition down, keep the YAML and set `blocked: true`',
    '  in state/published.json instead (docs/takedown-runbook.md).',
    '',
  );
  throw new Error(lines.join('\n'));
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
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as PublishedFile & { festivals?: unknown; default?: unknown };
  assertStamp(parsed.publishedAt, `${path} publishedAt`);
  if (parsed.festivals !== undefined || parsed.editions === undefined) {
    throw new Error(
      `${path}: expected an \`editions\` map keyed by edition path (\`<slug>-<year>\` or \`fan/<slug>-<year>\`), ` +
        `each with slug, year, namespace, listed, blocked and stages. The pre-namespace \`festivals\`/\`default\` shape is no longer read — see README.`,
    );
  }
  for (const [key, record] of Object.entries(parsed.editions)) {
    const expected = editionPath(record.namespace, `${record.slug}-${record.year}`);
    if (record.namespace !== 'owner' && record.namespace !== 'fan') {
      throw new Error(`${path}: editions["${key}"].namespace must be "owner" or "fan" (got ${JSON.stringify(record.namespace)})`);
    }
    if (key !== expected) {
      throw new Error(`${path}: editions["${key}"] should be keyed "${expected}" (namespace ${record.namespace}, ${record.slug}-${record.year})`);
    }
    if (typeof record.listed !== 'boolean' || typeof record.blocked !== 'boolean') {
      throw new Error(`${path}: editions["${key}"] needs boolean \`listed\` and \`blocked\` flags`);
    }
    if (!Array.isArray(record.stages)) throw new Error(`${path}: editions["${key}"].stages must be a list`);
    if (record.movedTo !== undefined && typeof record.movedTo !== 'string') {
      throw new Error(`${path}: editions["${key}"].movedTo must be an edition path`);
    }
  }
  return parsed;
}

export function readSequences(path: string): SequencesFile {
  if (!existsSync(path)) return { editions: {} };
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as SequencesFile & { events?: unknown };
  if (parsed.events !== undefined) {
    throw new Error(
      `${path}: found the flat \`events\` ledger. Sequences are now kept per edition under \`editions\`, ` +
        `keyed by edition path — move the existing entries under the edition they belong to (see README).`,
    );
  }
  return { $comment: parsed.$comment, editions: parsed.editions ?? {} };
}

/** Every `*.yaml` under `dir`, recursively, as absolute paths in sorted order. */
export function listDataFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (d: string) => {
    for (const entry of readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && /\.ya?ml$/.test(entry.name)) out.push(full);
    }
  };
  walk(dir);
  return out.sort();
}

/** Load every edition under `<root>/data`. */
export function loadEditions(root: string): FestivalDoc[] {
  return listDataFiles(join(root, 'data')).map((file) => loadFestival(file));
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export interface RunOptions {
  /** Build only these YAML files instead of every file under data/. */
  dataFiles?: string[];
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

export async function run(options: RunOptions = {}): Promise<SiteBuildResult> {
  const root = options.repoRoot ?? REPO_ROOT;
  const log = options.log ?? ((m: string) => process.stdout.write(m + '\n'));
  const publishedPath = join(root, 'state', 'published.json');
  const sequencesPath = join(root, 'state', 'sequences.json');

  const published = readPublished(publishedPath);
  const dataFiles = options.dataFiles ?? listDataFiles(join(root, 'data'));
  if (dataFiles.length === 0) throw new Error(`No editions found under ${join(root, 'data')} — nothing to build.`);
  const docs = dataFiles.map((file) => loadFestival(file));

  // Ingest gate — before anything is written.
  for (const doc of docs) {
    if (options.production && !doc.verified) throw new UnverifiedScheduleError(doc);
    if (!doc.verified) {
      log(`  ⚠ ${editionPathOf(doc)} is UNVERIFIED — preview only, will not deploy to production.`);
    }
  }

  const sequencesFile = readSequences(sequencesPath);
  const publishedAt = process.env['STAGE_TIMES_PUBLISHED_AT'] ?? published.publishedAt;
  assertStamp(publishedAt, 'publishedAt');

  // Gate 4 runs inside buildSite, before anything is written.
  const result = buildSite(docs, published, sequencesFile, publishedAt);

  const changed = result.editions.reduce((n, e) => n + e.result.changedUids.length, 0);
  if (changed > 0) {
    const priorStamps = Object.values(sequencesFile.editions)
      .flatMap((ledger) => Object.values(ledger))
      .map((e) => e.lastModified);
    const newestPrior = priorStamps.sort().at(-1);
    if (newestPrior && publishedAt <= newestPrior) {
      process.stderr.write(
        `WARNING: ${changed} event(s) changed content but publishedAt (${publishedAt}) is not newer ` +
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
    const ledgers: Record<string, SequenceLedger> = {};
    for (const path of Object.keys(result.nextSequences).sort()) ledgers[path] = sortObjectKeys(result.nextSequences[path]!);
    writeFileSync(
      sequencesPath,
      stableJson({ $comment: sequencesFile.$comment ?? SEQUENCES_COMMENT, editions: ledgers }),
      'utf8',
    );
    writeFileSync(publishedPath, stableJson(result.nextPublished), 'utf8');
  }

  // Optional page rendering, owned by someone else. Guarded so the feed build
  // still works before src/pages.ts exists.
  const pagesSrc = join(HERE, 'pages.ts');
  if (existsSync(pagesSrc)) {
    // Indirect specifier on purpose: src/pages.ts is owned by the page builder and
    // may not exist yet, and a static specifier would fail typecheck until it does.
    const spec = './pages.js';
    const mod = (await import(spec)) as { renderSitePages?: (s: SiteManifest, out: string) => unknown };
    if (typeof mod.renderSitePages === 'function') {
      await mod.renderSitePages(result.site, outDir);
      log('  rendered pages via src/pages.ts');
    } else {
      log('  src/pages.ts exists but exports no renderSitePages(site, outDir) — skipping HTML');
    }
  } else {
    log('  src/pages.ts not present — feeds only, no HTML');
  }

  for (const { path, result: r } of result.editions) {
    const m = r.manifest;
    log(
      `Built ${path}${m.blocked ? ' (BLOCKED — empty feeds)' : ''}${m.listed ? ' (listed)' : ''}: ` +
        `${m.stages.length} stage feeds + all.ics, ${m.allSetCount} sets, lastUpdated ${m.lastUpdated}` +
        (r.newUids.length ? `, ${r.newUids.length} new event(s)` : '') +
        (r.changedUids.length ? `, ${r.changedUids.length} changed event(s)` : ''),
    );
  }
  log(`Built ${result.editions.length} edition(s) from ${relative(root, join(root, 'data')) || 'data'}/.`);
  return result;
}

export const SEQUENCES_COMMENT = [
  'COMMITTED STATE — do not hand-edit casually and never delete.',
  'Keyed by edition path (`<slug>-<year>` for owner editions, `fan/<slug>-<year>` for fan editions), then by UID.',
  '`sequence` advances only when `hash` (the subscriber-visible content of the event) changes.',
  'Clients ignore an update whose SEQUENCE has not advanced, so losing this file means published edits stop propagating.',
  'lastModified is the publishedAt stamp of the build that last changed the event; it becomes DTSTAMP and LAST-MODIFIED.',
  'Entries are never pruned: if an act is dropped and later re-added its SEQUENCE must not go backwards.',
  'A blocked edition leaves its ledger untouched, so a revert of the block resumes exactly where it left off.',
];

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const args = process.argv.slice(2);
  // --dry-state builds feeds without touching state/. Use it when building a test
  // fixture (e.g. tests/fixtures/dst-check-2026.yaml) so its UIDs never land in
  // the committed sequence ledger for a real edition.
  const dryState = args.includes('--dry-state');
  // --production refuses to build an unverified schedule. Vercel production
  // deploys set VERCEL_ENV=production, so the gate applies there without anyone
  // having to remember the flag; preview deploys build freely.
  const production = args.includes('--production') || process.env['VERCEL_ENV'] === 'production';
  const positional = args.filter((a) => !a.startsWith('--'));
  run({ dataFiles: positional.length ? positional.map((a) => resolve(a)) : undefined, dryState, production }).catch(
    (err: unknown) => {
      process.stderr.write((err instanceof Error ? err.message : String(err)) + '\n');
      process.exitCode = 1;
    },
  );
}
