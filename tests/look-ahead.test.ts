/**
 * The look-ahead: once a month, one issue listing every edition in the
 * almanac starting in the next ninety days, and the watch-list entry for each
 * one nobody watches yet. Fake notify and clock ports, as in
 * tests/signal.test.ts; what each test asserts on is the issue that crossed
 * the seam.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';

import { loadAlmanac, lookAhead, LOOK_AHEAD_DAYS, type Almanac, type LookAheadResult } from '../src/look-ahead.js';
import { keyOf, loadWatchList, type WatchList } from '../src/watcher.js';
import { REPO_ROOT } from './helpers.js';
import { fakeClock, fakeNotifier, type FakeNotifier } from './publisher-fakes.js';

/** The monthly run: the 1st of October 2026, 15:00 UTC. */
const FIRST_RUN = Date.UTC(2026, 9, 1, 15, 0, 0);

const ALMANAC = `
- festival: Low Tide
  source: https://lowtide.example/schedule
  timezone: America/Los_Angeles
  form: poster
  subreddit: LowTideFest
  editions:
    - year: 2025
      dates: { first: 2025-10-10, last: 2025-10-12 }
      dropped: 2025-08-15
    - year: 2026
      dates: { first: 2026-10-09, last: 2026-10-11 }

- festival: Night Owl
  slug: night-owl-fl
  source: https://nightowl.example/
  timezone: America/New_York
  form: app
  editions:
    - year: 2025
      dates: { first: 2025-11-07, last: 2025-11-09 }
      dropped: 2025-11-04
    - year: 2026
      dates: { first: 2026-11-06, last: 2026-11-08 }

- festival: Harbor Lights
  source: https://harborlights.example/lineup
  timezone: America/Chicago
  form: unknown
  editions:
    - year: 2026
      dates: { first: 2026-12-04, last: 2026-12-05 }

- festival: Ember
  source: https://ember.example/
  timezone: America/Denver
  form: poster
  editions:
    - year: 2025
      dates: { first: 2025-11-21, last: 2025-11-22 }
      dropped: 2025-10-01

- festival: Far Off
  source: https://faroff.example/
  timezone: America/Denver
  form: poster
  editions:
    - year: 2027
      dates: { first: 2027-04-10, last: 2027-04-12 }
`;

const WATCHED: WatchList = loadWatchList(`
- festival: Low Tide
  year: 2026
  source: https://lowtide.example/schedule
  timezone: America/Los_Angeles
  dates: { first: 2026-10-09, last: 2026-10-11 }
  window: { from: 2026-08-01 }
`);

async function run(almanac: Almanac = loadAlmanac(ALMANAC), list: WatchList = WATCHED, now = FIRST_RUN): Promise<{ result: LookAheadResult; notify: FakeNotifier }> {
  const notify = fakeNotifier();
  const result = await lookAhead({ kind: 'look-ahead', almanac, list }, { notify, clock: fakeClock(now) });
  return { result, notify };
}

/** The table row for an edition, as the issue prints it. */
function tableRow(body: string, edition: string): string {
  const row = body.split('\n').find((l) => l.startsWith(`| ${edition} |`));
  assert.ok(row, `the issue has a row for ${edition}`);
  return row;
}

// ---------------------------------------------------------------------------
// Box 1: a monthly schedule, one issue titled with the month and the window
// ---------------------------------------------------------------------------

test('look-ahead: the job runs on a monthly schedule and opens one issue titled with the month and the window', async () => {
  const workflow = parseYaml(readFileSync(join(REPO_ROOT, '.github/workflows/look-ahead.yml'), 'utf8')) as {
    on: { schedule: { cron: string }[] };
    permissions: Record<string, string>;
    jobs: Record<string, { steps: { run?: string }[] }>;
  };
  const crons = workflow.on.schedule.map((s) => s.cron);
  assert.equal(crons.length, 1, 'one schedule');
  const [minute, hour, dayOfMonth, month, dayOfWeek] = crons[0]!.split(/\s+/);
  assert.ok(/^\d+$/.test(minute!) && /^\d+$/.test(hour!) && /^\d+$/.test(dayOfMonth!), 'one fixed minute, hour and day of the month');
  assert.equal(month, '*', 'every month');
  assert.equal(dayOfWeek, '*', 'whatever the weekday');
  assert.equal(workflow.permissions['issues'], 'write', 'it can open the issue');
  assert.ok(Object.values(workflow.jobs).some((j) => j.steps.some((s) => s.run === 'npm run look-ahead')), 'it runs the look-ahead');

  const { result, notify } = await run();
  assert.equal(notify.sent.length, 1, 'one issue per run');
  assert.equal(notify.sent[0]!.kind, 'look-ahead', 'labelled look-ahead');
  assert.equal(notify.sent[0]!.title, 'Look-ahead for October 2026: 1 Oct to 29 Dec 2026');
  assert.deepEqual(result.window, { from: '2026-10-01', to: '2026-12-29' }, `${LOOK_AHEAD_DAYS} days, counting the day it runs`);

  const empty = await run([], [], Date.UTC(2027, 5, 1, 15));
  assert.equal(empty.notify.sent.length, 1, 'a month with nothing coming still gets its issue');
  assert.match(empty.notify.sent[0]!.body, /Nothing on record/);
});

// ---------------------------------------------------------------------------
// Box 2: each row — edition, dates, expected drop lead, source form, watched
// ---------------------------------------------------------------------------

test('look-ahead: each row names the edition, dates, expected drop lead from the previous edition, source form, and watched status', async () => {
  const { result, notify } = await run();
  const body = notify.sent[0]!.body;

  assert.deepEqual(result.rows.map((r) => r.key), ['low-tide-2026', 'night-owl-fl-2026', 'harbor-lights-2026', 'ember-2026'], 'earliest first; days not on record last');
  assert.ok(!body.includes('Far Off'), 'an edition past the ninety days is not listed');

  // 2025 dropped 15 Aug for a 10 Oct start: 56 days. 2026 starts 9 Oct.
  assert.deepEqual(result.rows[0]!.expected, { from: 2025, leadDays: 56, on: '2026-08-14' });
  assert.equal(tableRow(body, 'Low Tide 2026'), '| Low Tide 2026 | 9–11 Oct | Around 14 Aug (8 weeks ahead, as in 2025) | Images on the site | Yes |');
  assert.equal(tableRow(body, 'Night Owl 2026'), '| Night Owl 2026 | 6–8 Nov | Around 3 Nov (3 days ahead, as in 2025) | App only | No |');
  assert.equal(tableRow(body, 'Harbor Lights 2026'), '| Harbor Lights 2026 | 4–5 Dec | No earlier drop on record | Not known yet | No |');
  assert.equal(tableRow(body, 'Ember 2026'), '| Ember 2026 | Not on record | Unknown | Images on the site | No |', 'last year’s days come round with no 2026 on record');
  assert.match(body, /## Days not on record\n\n- \[ \] Ember 2026: add its days to `config\/festivals.yaml`\./);
});

// ---------------------------------------------------------------------------
// Box 3: the exact watch-list edit for an unwatched festival
// ---------------------------------------------------------------------------

test('look-ahead: rows for unwatched festivals include the exact watch-list edit, and appending it watches the edition', async () => {
  const { result, notify } = await run();
  const body = notify.sent[0]!.body;

  assert.equal(result.rows.find((r) => r.key === 'low-tide-2026')!.edit, null, 'a watched edition carries no edit');
  assert.equal(result.rows.find((r) => r.key === 'ember-2026')!.edit, null, 'nor does one with no days to watch');

  const nightOwl = result.rows.find((r) => r.key === 'night-owl-fl-2026')!;
  assert.equal(
    nightOwl.edit,
    [
      '- festival: Night Owl',
      '  slug: night-owl-fl',
      '  year: 2026',
      '  source: https://nightowl.example/',
      '  timezone: America/New_York',
      '  dates: { first: 2026-11-06, last: 2026-11-08 }',
      '  window: { from: 2026-10-27 }',
    ].join('\n'),
    'the window opens a week before the expected drop (3 Nov)',
  );
  const harbor = result.rows.find((r) => r.key === 'harbor-lights-2026')!;
  assert.match(harbor.edit!, /window: \{ from: 2026-10-01 \}/, 'no drop to go by: eleven weeks before 4 Dec is past, so it opens today');

  // The issue carries a checkbox and the entry, indented under it, for each.
  assert.ok(body.includes('- [ ] **Night Owl 2026**, 6–8 Nov. App only: the watcher reads images only, so add a subreddit for the signal too.'));
  assert.ok(body.includes(`  \`\`\`yaml\n${nightOwl.edit!.split('\n').map((l) => `  ${l}`).join('\n')}\n  \`\`\``), 'the entry, fenced, under its checkbox');
  assert.ok(body.includes('- [ ] **Harbor Lights 2026**'));

  // Appending the edits to the committed watch list watches every edition in the window.
  const current = readFileSync(join(REPO_ROOT, 'config/watch.yaml'), 'utf8');
  const edited = loadWatchList([current, ...result.rows.filter((r) => r.edit).map((r) => r.edit!)].join('\n\n'));
  for (const r of result.rows.filter((row) => row.edit)) assert.ok(edited.some((e) => keyOf(e) === r.key), `${r.key} is watched after the edit`);
  const again = await run(loadAlmanac(ALMANAC), loadWatchList([readFileSync(join(REPO_ROOT, 'config/watch.yaml'), 'utf8'), ...result.rows.filter((r) => r.edit).map((r) => r.edit!)].join('\n\n')));
  assert.ok(again.result.rows.filter((r) => r.dates).every((r) => r.key === 'low-tide-2026' || r.watched), 'the next run reads them as watched');

  // A subreddit and a match travel with the entry.
  const low = loadAlmanac(ALMANAC).find((f) => f.slug === 'low-tide')!;
  const unwatched = await run([{ ...low, match: 'Wk2' }], []);
  assert.match(unwatched.result.rows[0]!.edit!, /\n {2}match: Wk2\n {2}subreddit: LowTideFest$/);
  assert.match(unwatched.result.rows[0]!.edit!, /window: \{ from: 2026-10-01 \}/, 'an expected drop already past opens the window today');
});

// ---------------------------------------------------------------------------
// Box 4: the first run, over the committed almanac and watch list
// ---------------------------------------------------------------------------

test('look-ahead: the first run covers October and November 2026 from the committed almanac and watch list', async () => {
  const almanac = loadAlmanac(readFileSync(join(REPO_ROOT, 'config/festivals.yaml'), 'utf8'));
  const list = loadWatchList(readFileSync(join(REPO_ROOT, 'config/watch.yaml'), 'utf8'));
  const { result, notify } = await run(almanac, list);

  const inOctNov = almanac.flatMap((f) => f.editions.filter((e) => e.dates.first >= '2026-10-01' && e.dates.first <= '2026-11-30').map((e) => keyOf({ slug: f.slug, year: e.year })));
  assert.ok(inOctNov.length > 0, 'the almanac has October and November on record');
  for (const key of inOctNov) assert.ok(result.rows.some((r) => r.key === key), `${key} is in the first run`);
  for (const r of result.rows) assert.equal(r.watched, list.some((e) => keyOf(e) === r.key), `${r.key}'s watched status is the watch list's`);
  assert.ok(result.rows.filter((r) => !r.watched && r.dates).every((r) => r.edit), 'every unwatched edition carries its edit');
  assert.equal(notify.sent[0]!.title, 'Look-ahead for October 2026: 1 Oct to 29 Dec 2026');
});

// ---------------------------------------------------------------------------
// The almanac
// ---------------------------------------------------------------------------

test('look-ahead: the almanac refuses what the look-ahead cannot use, naming the festival and the field', () => {
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
