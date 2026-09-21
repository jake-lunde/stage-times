/**
 * Headliners — the acts a stage bills as its closer each night (owner rulings, 2026-09-21).
 *
 *   - `headliners:` on a stage is optional, display only, and every name must be a set on
 *     that stage spelled exactly.
 *   - Absent, the headliner is the last set of each night, and a night runs until 6 AM:
 *     a 1:45 AM set belongs to the night before.
 *   - The manifest carries the billed list when there is one; the card art stars those sets.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadFestivalFromString, SchemaError } from '../src/schema.js';
import { buildFeeds, nightOf } from '../src/build.js';
import { beadsArt, dateRange } from '../src/pages.js';
import { emptyState } from './helpers.js';

const harborYaml = readFileSync(new URL('./fixtures/harbor-lights-2026.yaml', import.meta.url), 'utf8');

function withHeadliners(yaml: string, stageId: string, names: string[]): string {
  const list = names.map((n) => JSON.stringify(n)).join(', ');
  return yaml.replace(new RegExp(`(  - id: "${stageId}"\\n(?:    .*\\n)*?)(?=  - id:|\\nsets:)`), `$1    headliners: [${list}]\n`);
}

test('nightOf: a set before 6 AM belongs to the night before', () => {
  const at = (day: number, hour: number, minute = 0) => ({
    year: 2026, month: 8, day, hour, minute, second: 0, ical: '', raw: '',
  });
  assert.equal(nightOf(at(8, 22, 40)), '2026-08-08');
  assert.equal(nightOf(at(9, 1, 45)), '2026-08-08', '1:45 AM on the 9th is still the night of the 8th');
  assert.equal(nightOf(at(9, 5, 59)), '2026-08-08');
  assert.equal(nightOf(at(9, 6, 0)), '2026-08-09', '6 AM starts a new day');
  assert.equal(nightOf(at(1, 2, 0)), '2026-07-31', 'the rule crosses a month boundary');
});

test('schema: headliners is optional, and every name must be a set on that stage', () => {
  const plain = loadFestivalFromString(harborYaml, 'harbor');
  assert.deepEqual(plain.stages.map((s) => s.headliners), plain.stages.map(() => []));

  const main = plain.stages[0]!;
  const artist = plain.sets.find((s) => s.stage === main.id)!.artist;
  const ok = loadFestivalFromString(withHeadliners(harborYaml, main.id, [artist]), 'harbor+h');
  assert.deepEqual(ok.stages[0]!.headliners, [artist]);

  assert.throws(
    () => loadFestivalFromString(withHeadliners(harborYaml, main.id, ['NOBODY']), 'harbor+bad'),
    (err: unknown) => err instanceof SchemaError && err.problems.some((p) => p.includes('headliner "NOBODY"')),
    'a headliner that is not a set on its stage is refused',
  );
  const other = plain.sets.find((s) => s.stage !== main.id)!.artist;
  assert.throws(
    () => loadFestivalFromString(withHeadliners(harborYaml, main.id, [other]), 'harbor+wrongstage'),
    (err: unknown) => err instanceof SchemaError,
    'a set on another stage does not count',
  );
});

test('manifest: billed headliners win; otherwise the last set of each night', () => {
  const plain = loadFestivalFromString(harborYaml, 'harbor');
  const plainBuild = buildFeeds(plain, emptyState('20260808T000000Z'));
  const main = plainBuild.manifest.stages[0]!;
  assert.ok(main.headliners.length > 0, 'derived headliners exist');
  const notLast = plain.sets.filter((s) => s.stage === main.id).find((s) => !main.headliners.includes(s.artist))!.artist;
  const billedBuild = buildFeeds(loadFestivalFromString(withHeadliners(harborYaml, main.id, [notLast]), 'harbor+h'), emptyState('20260808T000000Z'));
  assert.deepEqual(billedBuild.manifest.stages[0]!.headliners, [notLast]);
  // The feeds do not change: headliners are display only.
  assert.deepEqual([...billedBuild.files.entries()], [...plainBuild.files.entries()], 'no feed byte changes');
});

test('card art: the billed headliner is the starred, named set', () => {
  const plain = loadFestivalFromString(harborYaml, 'harbor');
  const m = buildFeeds(plain, emptyState('20260808T000000Z')).manifest;
  const stage = m.stages[0]!;
  const days = dateRange(m.all.dayspan.first, m.all.dayspan.last);
  const pick = stage.sets[0]!.artist;
  const art = beadsArt({ ...stage, headliners: [pick] }, '#C42408', days);
  assert.ok(art.includes(`class="disp"`), 'the name is drawn');
  assert.ok(art.includes(`>${pick.replace(/&/g, '&amp;')}</text>`), 'the billed act is the name shown');
  assert.equal((art.match(/class="unrot"/g) ?? []).length, 1, 'one star: the billed act');
  assert.ok(art.includes(`aria-label="Headliners: ${pick.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`));
});
