/**
 * The almanac: the committed record of festivals, their schedule pages and
 * their time zones. The upload review reads it for the zone a festival on
 * record prints its times in.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { loadAlmanac, zoneOnRecord, type Almanac } from '../src/almanac.js';
import { REPO_ROOT } from './helpers.js';

test('almanac: refuses what it cannot use, naming the festival and the field', () => {
  const base = { festival: 'Low Tide', source: 'https://lowtide.example/', timezone: 'America/Los_Angeles', form: 'poster', editions: [{ year: 2026, dates: { first: '2026-10-09', last: '2026-10-11' } }] };
  const load = (over: Record<string, unknown>): Almanac => loadAlmanac(JSON.stringify([{ ...base, ...over }]));
  assert.equal(load({})[0]!.slug, 'low-tide', 'the slug derives from the name');
  assert.throws(() => load({ form: 'poster-ish' }), /Low Tide.*form is required/);
  assert.throws(() => load({ timezone: 'Pacific' }), /timezone/);
  assert.throws(() => load({ source: 'lowtide.example' }), /source/);
  assert.throws(() => load({ editions: [] }), /editions/);
  assert.throws(() => load({ editions: [{ year: 2026, dates: { first: '2025-10-09', last: '2025-10-11' } }] }), /not in 2026/);
  assert.throws(() => load({ editions: [{ year: 2026, dates: { first: '2026-10-09', last: '2026-10-11' }, dropped: '2026-10-12' }] }), /dropped/);
  assert.throws(() => load({ editions: [base.editions[0], base.editions[0]] }), /on record twice/);
  assert.throws(() => loadAlmanac(JSON.stringify([base, base])), /twice/);
});

// ---------------------------------------------------------------------------
// The zone on record
// ---------------------------------------------------------------------------

test("almanac: a festival's zone is found by its schedule page's host, else by its name, and never guessed", () => {
  const almanac = loadAlmanac(readFileSync(join(REPO_ROOT, 'config', 'festivals.yaml'), 'utf8'));
  assert.equal(zoneOnRecord(almanac, { url: 'https://www.aclfestival.com/schedule' }), 'America/Chicago', 'by host');
  assert.equal(zoneOnRecord(almanac, { url: 'http://aclfestival.com/some/other/page?x=1' }), 'America/Chicago', 'www. and the path aside');
  assert.equal(zoneOnRecord(almanac, { name: 'AUSTIN CITY LIMITS MUSIC FESTIVAL 25 YEARS' }), 'America/Chicago', 'by the printed name, which starts with the festival');
  assert.equal(zoneOnRecord(almanac, { name: 'Austin City Limits' }), 'America/Chicago', 'by the name exactly');
  assert.equal(zoneOnRecord(almanac, { name: 'III Points 2026' }), 'America/New_York', 'a festival with its own slug');
  assert.equal(zoneOnRecord(almanac, { url: 'https://elsewhere.example/schedule', name: 'Low Tide' }), null, 'nothing on record is no zone');
  assert.equal(zoneOnRecord(almanac, { url: 'not a link', name: '' }), null, 'garbage is no zone');
  assert.equal(zoneOnRecord(almanac, {}), null);
  assert.equal(zoneOnRecord(almanac, { url: 'https://elsewhere.example/', name: 'AUSTIN CITY LIMITS MUSIC FESTIVAL' }), 'America/Chicago', 'an unknown host does not stop the name matching');
});
