/**
 * Analytics surface honesty: the Vercel Web Analytics snippet belongs to HTML
 * pages and to nothing else. Calendar clients don't run JS — a script tag in an
 * .ics response is a parser-breaking bug, not an analytics feature. These tests
 * pin the boundary from both sides:
 *
 *   - every rendered HTML page carries the stub + the deferred insights script
 *   - every generated .ics (and feeds.json) carries no trace of it
 *   - the one custom event ("subscribe") is wired with {festival, stage} only —
 *     aggregate, cookieless, no per-subscriber anything
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildFeeds } from '../src/build.js';
import { renderLandingPage, renderSubscribePage } from '../src/pages.js';
import { buildDst, emptyState, harborDoc } from './helpers.js';

const INSIGHTS_SRC = '/_vercel/insights/script.js';
const VA_STUB = 'window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };';

const harborBuild = buildFeeds(harborDoc(), emptyState('20260808T000000Z'));
const dstBuild = buildDst();

const landing = renderLandingPage(harborBuild.manifest);
const subscribe = renderSubscribePage(harborBuild.manifest);

// ===========================================================================
// Present on every HTML page
// ===========================================================================

test('analytics: every rendered HTML page carries the insights script and its va stub', () => {
  for (const [name, html] of [
    ['landing', landing],
    ['subscribe', subscribe],
  ] as const) {
    assert.ok(html.includes(`<script defer src="${INSIGHTS_SRC}"></script>`), `${name}: insights script tag`);
    assert.ok(html.includes(VA_STUB), `${name}: window.va queue stub`);
    // The stub must come first, or events fired before the deferred script
    // loads are dropped instead of queued.
    assert.ok(
      html.indexOf(VA_STUB) < html.indexOf(INSIGHTS_SRC),
      `${name}: va stub must precede the script tag`,
    );
    // Both belong in <head>; a snippet that drifts into the body still works,
    // but pin the intended placement so a refactor can't silently halve it.
    assert.ok(html.indexOf(INSIGHTS_SRC) < html.indexOf('</head>'), `${name}: snippet must be in <head>`);
  }
});

// ===========================================================================
// The subscribe event: one event, {festival, stage}, nothing else
// ===========================================================================

test('analytics: every subscribe button carries festival + stage data attributes', () => {
  const manifest = harborBuild.manifest;
  const anchors = subscribe.match(/<a class="btn[^>]*href="webcal:[^>]*>/g) ?? [];
  assert.equal(
    anchors.length,
    manifest.stages.length + 1,
    'one subscribe anchor per stage, plus All Stages',
  );

  const seenStages: string[] = [];
  for (const a of anchors) {
    const festival = /data-festival="([^"]*)"/.exec(a)?.[1];
    const stage = /data-stage="([^"]*)"/.exec(a)?.[1];
    assert.equal(festival, manifest.festival.key, `anchor must name the festival key: ${a}`);
    assert.ok(stage, `anchor must name its stage: ${a}`);
    seenStages.push(stage!);
  }
  assert.deepEqual(
    seenStages.sort(),
    [...manifest.stages.map((s) => s.id), manifest.all.id].sort(),
    'data-stage values must be exactly the stage ids plus the all feed',
  );
});

test('analytics: the click handler sends exactly one custom event, named "subscribe"', () => {
  assert.ok(subscribe.includes("name: 'subscribe'"), 'the subscribe tap event must be wired');
  const eventCalls = subscribe.match(/va\('event'/g) ?? [];
  assert.equal(eventCalls.length, 1, 'one custom event only — subscribe taps');
  // The event payload is festival + stage and nothing else. No URL, no token,
  // no anything that could identify a subscriber.
  assert.match(
    subscribe,
    /data: \{ festival: sub\.getAttribute\('data-festival'\), stage: sub\.getAttribute\('data-stage'\) \}/,
    'event data must be exactly {festival, stage}',
  );
});

test('analytics: the landing page fires no custom events (pageviews only)', () => {
  assert.equal(landing.includes("va('event'"), false);
});

// ===========================================================================
// Absent from every non-HTML output
// ===========================================================================

test('analytics: no .ics output contains a script tag or any analytics trace', () => {
  const builds: [string, Map<string, string>][] = [
    ['harbor', harborBuild.files],
    ['dst', dstBuild.files],
  ];
  let checked = 0;
  for (const [label, files] of builds) {
    for (const [path, text] of files) {
      if (!path.endsWith('.ics')) continue;
      checked++;
      assert.equal(text.includes('_vercel'), false, `${label}/${path}: analytics path leaked into a feed`);
      assert.equal(text.toLowerCase().includes('<script'), false, `${label}/${path}: script tag in a feed`);
      assert.equal(text.includes('window.va'), false, `${label}/${path}: va stub in a feed`);
    }
  }
  assert.ok(checked >= 7, `expected to check every feed from both fixtures, only saw ${checked}`);
});

test('analytics: feeds.json is data, not a page — no analytics trace there either', () => {
  const feedsJson = harborBuild.files.get('feeds.json');
  assert.ok(feedsJson, 'harbor build must emit feeds.json');
  assert.equal(feedsJson!.includes('_vercel'), false);
  assert.equal(feedsJson!.toLowerCase().includes('<script'), false);
});
