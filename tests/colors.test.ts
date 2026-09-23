/**
 * Festival colors (owner ruling, 2026-09-23). A stage's color is the
 * festival's own, sampled off its art, when the edition names enough of them,
 * and the house colors otherwise. A light festival color keeps its brightness
 * and prints ink, the way its poster does, rather than being darkened until
 * cream passes. The color is on the stage card and in the stage's feed as
 * X-APPLE-CALENDAR-COLOR. This file pins the rule, the schema, the feed, the
 * page, a new reading of a live edition, and ACL 2026, the first to use it.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { CREAM, HOUSE_COLORS, INK, colorProblems, contrast, stageColors, textOn } from '../src/colors.js';
import { SchemaError, loadFestival } from '../src/schema.js';
import { buildFeeds } from '../src/build.js';
import { beadsArt, renderSubscribePage } from '../src/pages.js';
import { transcribe } from '../src/transcription.js';
import { REPO_ROOT, docFromText, emptyState, getProps, harborDoc } from './helpers.js';

const ACL_PATH = join(REPO_ROOT, 'data', 'austin-city-limits-2026.yaml');

function aclYaml(): string {
  return readFileSync(ACL_PATH, 'utf8');
}

// ---------------------------------------------------------------------------
// The rule
// ---------------------------------------------------------------------------

test('colors: a color takes cream text when cream clears 4.5:1, ink when it does not', () => {
  for (const c of HOUSE_COLORS) assert.equal(textOn(c), CREAM, `${c} is a house color and takes cream`);
  assert.equal(textOn('#EE79B5'), INK, 'the ACL pink takes ink (cream is 2.5:1 on it)');
  assert.equal(textOn('#0088D3'), INK, 'the ACL blue takes ink (cream is 3.7:1, ink 4.6:1)');
  assert.ok(contrast('#0088D3', INK) >= 4.5, 'and ink clears the floor on it');
});

test('colors: the schema check refuses a bad hex, a color no text can be read on, and two colors too close', () => {
  assert.deepEqual(colorProblems(['#EE79B5', '#0088D3']), [], 'two good colors');
  assert.match(colorProblems(['pink'])[0] ?? '', /not a #RRGGBB color/);
  const neither = colorProblems(['#FC004C']);
  assert.equal(neither.length, 1, 'the averaged ACL hot pink: cream 3.8:1, ink 4.46:1');
  assert.match(neither[0]!, /neither cream text .* nor ink/);
  assert.deepEqual(colorProblems(['#FF004B']), [], 'the pixel sampled off the art clears ink at 4.55:1');
  assert.match(colorProblems(['#EE79B5', '#EE7AB3'])[0] ?? '', /too close to `colors\[0\]`/);
});

test('colors: a stage takes the festival color at its position in its weekend; short or absent means the house colors, never a mix', () => {
  const stages = [
    { id: 'a-1', weekend: 'Weekend 1' },
    { id: 'b-1', weekend: 'Weekend 1' },
    { id: 'a-2', weekend: 'Weekend 2' },
    { id: 'b-2', weekend: 'Weekend 2' },
  ];
  const mine = stageColors(stages, ['#ee79b5', '#FF7800']);
  assert.deepEqual([...mine.values()], ['#EE79B5', '#FF7800', '#EE79B5', '#FF7800'], 'a stage is one color on both weekends');
  assert.deepEqual([...stageColors(stages, ['#EE79B5']).values()], [HOUSE_COLORS[0], HOUSE_COLORS[1], HOUSE_COLORS[0], HOUSE_COLORS[1]]);
  assert.deepEqual([...stageColors(stages).values()], [HOUSE_COLORS[0], HOUSE_COLORS[1], HOUSE_COLORS[0], HOUSE_COLORS[1]]);
});

// ---------------------------------------------------------------------------
// The schema
// ---------------------------------------------------------------------------

test('schema: `festival.colors` is optional, uppercased, and refused with every problem listed', () => {
  assert.equal(harborDoc().festival.colors, undefined, 'absent is fine');
  const yaml = aclYaml();
  const lower = docFromText(yaml.replace('"#EE79B5"', '"#ee79b5"'));
  assert.equal(lower.festival.colors?.[0], '#EE79B5');
  assert.throws(
    () => docFromText(yaml.replace('"#EE79B5"', '"#FC004C"').replace('"#FF7800"', '"orange"')),
    (err: unknown) => {
      assert.ok(err instanceof SchemaError, 'a SchemaError');
      assert.match(err.message, /colors\[0\]` #FC004C takes neither/);
      assert.match(err.message, /colors\[1\]` "orange" is not a #RRGGBB color/);
      return true;
    },
  );
  assert.throws(() => docFromText(yaml.replace(/colors: \[.*\]/, 'colors: "#EE79B5"')), /must be a list of #RRGGBB colors/);
});

// ---------------------------------------------------------------------------
// The feed and the page
// ---------------------------------------------------------------------------

test('feed: each stage calendar carries its color as X-APPLE-CALENDAR-COLOR; all.ics carries none', () => {
  const doc = loadFestival(ACL_PATH);
  const r = buildFeeds(doc, emptyState());
  const color = (id: string) => getProps(r.files.get(`austin-city-limits-2026/${id}.ics`)!, 'X-APPLE-CALENDAR-COLOR');
  assert.deepEqual(color('t-mobile-weekend-1'), ['#EE79B5'], 'the first stage takes the first color');
  assert.deepEqual(color('t-mobile-weekend-2'), ['#EE79B5'], 'and keeps it on the second weekend');
  assert.deepEqual(color('kiddie-limits-weekend-2'), ['#A7DDF9'], 'the eighth stage takes the eighth');
  assert.deepEqual(getProps(r.files.get('austin-city-limits-2026/all.ics')!, 'X-APPLE-CALENDAR-COLOR'), [], 'no one stage color on all.ics');
  assert.deepEqual(
    r.manifest.stages.map((s) => s.color).slice(0, 8),
    doc.festival.colors,
    'the manifest carries the same colors to the page',
  );
});

test('page: a light festival color prints ink — the card, its pill, and the beads — and a house color stays cream', () => {
  const acl = buildFeeds(loadFestival(ACL_PATH), emptyState()).manifest;
  const html = renderSubscribePage(acl);
  const cards = html.match(/<li class="stage-card[^"]*" style="background:#[0-9A-F]{6}">/g) ?? [];
  assert.equal(cards.length, 16);
  assert.ok(cards.every((c) => c.includes('stage-card--ink')), 'every ACL color is light and takes ink');
  assert.match(html, /\.stage-card--ink \.btn--on-color\{background:#12181F; color:#FCF9F4\}/, 'the pill flips to ink');

  const stage = acl.stages[0]!;
  const art = beadsArt(stage, stage.color, ['2026-10-02', '2026-10-03', '2026-10-04']);
  assert.ok(art.includes(`fill="${INK}" fill-opacity=".95"`), 'ink beads on the light ground');
  assert.ok(!art.includes(`fill="${CREAM}"`), 'no cream mark to vanish into it');

  const house = renderSubscribePage(buildFeeds(harborDoc(), emptyState()).manifest);
  assert.ok(!house.includes('stage-card stage-card--ink'), 'the house colors all take cream');
});

// ---------------------------------------------------------------------------
// A new reading of a live edition
// ---------------------------------------------------------------------------

test('transcribe: a new reading of a live edition keeps its colors, in the YAML it writes', () => {
  const live = loadFestival(ACL_PATH);
  const reply = readFileSync(join(REPO_ROOT, 'tests', 'fixtures', 'model-output', 'chbp-2026-friday.json'), 'utf8');
  const t = transcribe([{ source: 'friday.webp', output: reply }], {
    namespace: 'owner',
    timezone: 'America/Los_Angeles',
    live: { festival: { colors: live.festival.colors }, stages: [] },
  });
  assert.deepEqual(t.edition.festival.colors, live.festival.colors);
  assert.match(t.yaml, /colors: \["#EE79B5", "#FF7800", "#0088D3", "#FFAC00", "#FF004B", "#00CFFA", "#FCCA76", "#A7DDF9"\]/);
});
