/**
 * Shared test fixtures. Not a test file — `npm test` globs tests/*.test.ts.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFeeds, type BuildResult, type BuildState } from '../src/build.js';
import { loadFestival, loadFestivalFromString, type FestivalDoc } from '../src/schema.js';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Frozen publish stamp for the golden-file fixture. Changing it invalidates every
 * committed golden .ics, which is the point: the goldens pin bytes, not behaviour.
 */
export const GOLDEN_PUBLISHED_AT = '20260101T000000Z';

// Fixtures live under tests/, not data/. `data/` holds real festivals that get
// published; a fixture sitting next to them is one wrong `--production` away from
// being deployed as if it were a real schedule.
export const DST_FIXTURE_PATH = join(REPO_ROOT, 'tests', 'fixtures', 'dst-check-2026.yaml');
export const HARBOR_FIXTURE_PATH = join(REPO_ROOT, 'tests', 'fixtures', 'harbor-lights-2026.yaml');
export const GOLDEN_DIR = join(REPO_ROOT, 'tests', 'golden');

export function dstDoc(): FestivalDoc {
  return loadFestival(DST_FIXTURE_PATH);
}

export function harborDoc(): FestivalDoc {
  return loadFestival(HARBOR_FIXTURE_PATH);
}

export function emptyState(publishedAt = GOLDEN_PUBLISHED_AT): BuildState {
  return { publishedAt, sequences: {} };
}

/** Build the DST fixture from a clean, fixed state — fully reproducible. */
export function buildDst(state: BuildState = emptyState()): BuildResult {
  return buildFeeds(dstDoc(), state);
}

export function dstYamlText(): string {
  return readFileSync(DST_FIXTURE_PATH, 'utf8');
}

/** Load a festival from YAML text, for tests that mutate a fixture in memory. */
export function docFromText(text: string, label = 'in-memory fixture'): FestivalDoc {
  return loadFestivalFromString(text, label);
}

/** Unfold physical lines back into logical content lines. */
export function logicalLines(ics: string): string[] {
  return ics
    .replace(/\r\n[ \t]/g, '')
    .split('\r\n')
    .filter((l) => l.length > 0);
}

export function getProps(ics: string, name: string): string[] {
  const prefix = name + ':';
  const paramPrefix = name + ';';
  return logicalLines(ics)
    .filter((l) => l.startsWith(prefix) || l.startsWith(paramPrefix))
    .map((l) => l.slice(l.indexOf(':') + 1));
}
