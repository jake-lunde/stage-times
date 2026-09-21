/**
 * Copy: the strings festival-goers see, pinned after the 6 Sep 2026 three-reader
 * review (docs/copy-review-2026-09-06.md, applied by ticket 15).
 *
 * The rules these enforce live in .claude/skills/stage-times-design/references/copy.md:
 * the action label is "Add calendar"; no "we"/"our"; no machinery vocabulary on a
 * page; every footer carries the unofficial line, the source, the updated stamp,
 * and a way to report a wrong time; a state label that can lie ships with its
 * recovery line. The golden feeds are untouched by this ticket — gate 2 proves it.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildFeeds } from '../src/build.js';
import { renderLandingPage, renderSubscribePage, zoneLabel } from '../src/pages.js';
import { HARBOR_PATH, PIER_PATH, buildFixtureSite, emptyState, harborDoc, pierDoc, visibleText } from './helpers.js';

const harborBuild = buildFeeds(harborDoc(), emptyState('20260808T000000Z'));
// The landing page lists listed editions: one owner card, one fan card.
const landing = renderLandingPage(
  buildFixtureSite([harborDoc(), pierDoc()], { [HARBOR_PATH]: { listed: true }, [PIER_PATH]: { listed: true } }).site,
);
const subscribe = renderSubscribePage(harborBuild.manifest);

const landingText = visibleText(landing);
const subscribeText = visibleText(subscribe);

// ===========================================================================
// The action label
// ===========================================================================

test('copy: every calendar button says "Add calendar", never "Subscribe"', () => {
  const anchors = subscribe.match(/<a class="btn[^>]*href="webcal:[^>]*>([^<]*)<\/a>/g) ?? [];
  assert.equal(anchors.length, harborBuild.manifest.stages.length + 1);
  for (const a of anchors) {
    assert.match(a, />Add calendar<\/a>$/, `button label: ${a}`);
  }
});

test('copy: "Subscribe" appears on a page only when quoting another platform\'s UI', () => {
  // Outlook's menu path and iOS's confirm sheet are the two permitted quotations.
  const hits = subscribeText.match(/Subscribe/g) ?? [];
  assert.equal(hits.length, 2, `unexpected "Subscribe" on the subscribe page: ${hits.length}`);
  assert.ok(subscribeText.includes('Add calendar → Subscribe from web'), 'Outlook menu path');
  assert.ok(subscribeText.includes('its sheet says "Subscribe", which is the same thing'), 'iOS sheet clause');
  assert.equal(landingText.includes('Subscribe'), false, 'landing page');
  assert.equal(landingText.includes('subscribe'), false, 'landing page, lowercase');
});

test('copy: the analytics event keeps its internal name "subscribe" so the metric history survives', () => {
  assert.ok(subscribe.includes("name: 'subscribe'"));
});

// ===========================================================================
// Voice: one person, no company
// ===========================================================================

test('copy: no "we", "our", or "us" anywhere a reader can see', () => {
  for (const [name, text] of [
    ['landing', landingText],
    ['subscribe', subscribeText],
  ] as const) {
    assert.doesNotMatch(text, /\b(we|we're|we've|our|ours|us)\b/i, `${name}: corporate first person`);
  }
});

test('copy: no machinery vocabulary on a page', () => {
  const banned = [
    /\biCalendar\b/,
    /\bfeed\b/i,
    /\bfeeds\b/i,
    /\bsubscription\b/i,
    /refresh hint/i,
    /TRANSCRIPTION\.md/,
    /\btranscribed\b/i,
    /America\/Los_Angeles|America\/Los Angeles/,
    /open an issue/i,
    /found an error/i,
    /honours?\b/i,
    /\bcolour\b/i,
  ];
  for (const [name, text] of [
    ['landing', landingText],
    ['subscribe', subscribeText],
  ] as const) {
    for (const re of banned) assert.doesNotMatch(text, re, `${name}: ${re}`);
  }
});

test('copy: no exclamation marks anywhere on either page', () => {
  assert.equal(landingText.includes('!'), false);
  assert.equal(subscribeText.includes('!'), false);
});

// ===========================================================================
// The specific rewrites
// ===========================================================================

test('copy: landing meta description and "What this is" are the rewritten lines', () => {
  assert.ok(
    landing.includes('content="Set times for each festival stage, as a calendar you can add to your phone."'),
  );
  assert.ok(landingText.includes('Add one calendar per stage. The sets show up in the calendar app you already use, and you can color or hide each stage on its own.'));
  assert.ok(landingText.includes('Two or three stages is usually all you want. Add those, skip the rest.'));
});

test('copy: subscribe meta description leads with the festival name', () => {
  const f = harborBuild.manifest.festival;
  assert.ok(
    subscribe.includes(
      `content="${f.name} ${f.year} set times, one calendar per stage. Add the stages you care about to your phone."`,
    ),
  );
});

test('copy: the all-stages caveat is the short spoken line, with the stage count as a word', () => {
  const n = harborBuild.manifest.stages.length;
  const word = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'][n];
  assert.ok(
    subscribeText.includes(`Pick two or three. All ${word} at once turns a day view into a wall of overlapping blocks.`),
  );
});

test('copy: the fallback section names both platforms and is the anchor the recovery line points at', () => {
  assert.ok(subscribe.includes('<section id="other-calendars">'));
  assert.ok(subscribeText.includes('Android, or on a computer?'));
  assert.equal(subscribeText.includes('Not on iPhone?'), false);
});

test('copy: the Google Calendar disclosure names the copy button and keeps the literal menu path', () => {
  assert.ok(subscribeText.includes('Desktop web only.'));
  assert.ok(subscribeText.includes('Tap the link icon on the stage card to copy its address. Then, on a computer:'));
  assert.ok(subscribeText.includes('Settings → Add calendar → From URL'));
  assert.ok(subscribeText.includes('Nothing on my end can make it faster.'));
});

test('copy: the iPhone disclosure matches the button and names the iOS sheet', () => {
  assert.ok(subscribeText.includes('Tap Add calendar above. iOS opens Calendar and asks you to confirm — its sheet says "Subscribe", which is the same thing. That\'s the whole flow. iOS checks for changes about twice a day, so a corrected time reaches you within half a day.'));
});

test('copy: the updated stamp names the zone the way a festival-goer would', () => {
  // The harbor fixture is America/Chicago; CHBP renders as Pacific (zoneLabel below).
  assert.ok(subscribeText.includes('Updated 8 August 2026. All times are local to the festival — Central.'));
});

test('zoneLabel: known zones get their spoken name, unknown zones fall back to the city', () => {
  assert.equal(zoneLabel('America/Los_Angeles'), 'Pacific');
  assert.equal(zoneLabel('America/New_York'), 'Eastern');
  assert.equal(zoneLabel('Europe/Amsterdam'), 'Amsterdam');
  assert.equal(zoneLabel('Australia/Lord_Howe'), 'Lord Howe');
});

test('copy: the unverified banner speaks plainly and names no repo file', () => {
  const unverified = visibleText(renderSubscribePage({ ...harborBuild.manifest, verified: false }));
  assert.ok(unverified.includes('Not checked yet'));
  assert.ok(unverified.includes("These times were read off the official posters by machine and nobody has checked them against the source. Don't plan your day around them yet."));
  assert.equal(unverified.includes('TRANSCRIPTION'), false);
  const verified = visibleText(renderSubscribePage({ ...harborBuild.manifest, verified: true }));
  assert.equal(verified.includes('Not checked yet'), false, 'a verified build shows no banner');
});

// ===========================================================================
// Footers, and the state label that can lie
// ===========================================================================

test('copy: both footers carry the unofficial line and the wrong-time report link', () => {
  for (const [name, html, text] of [
    ['landing', landing, landingText],
    ['subscribe', subscribe, subscribeText],
  ] as const) {
    assert.ok(text.includes('Unofficial. Not affiliated with'), `${name}: unofficial`);
    assert.ok(text.includes('Wrong time? Tell me ↗'), `${name}: report line`);
    assert.ok(
      html.includes('Wrong time? <a href="https://github.com/jake-lunde/stage-times/issues">Tell me ↗</a>'),
      `${name}: the report link target is unchanged`,
    );
  }
  assert.ok(subscribeText.includes('Source: the official schedule'), 'subscribe: attribution');
  assert.ok(
    landingText.includes("Times come from each festival's official schedule. Each festival page says when it was last checked."),
    'landing: attribution + where the stamp lives',
  );
});

test('copy: "Opening Calendar…" ships with a hidden recovery line under every button, revealed on restore', () => {
  const n = harborBuild.manifest.stages.length + 1;
  const lines = subscribe.match(/<p class="recover" hidden>Didn't open\? Android needs a computer — <a href="#other-calendars">see below ↓<\/a><\/p>/g) ?? [];
  assert.equal(lines.length, n, 'one recovery line per Add calendar button');
  assert.ok(subscribe.includes("sub.textContent = 'Opening Calendar\\u2026';"));
  assert.ok(subscribe.includes("querySelector('.recover')"), 'the restore reveals the recovery line');
  assert.ok(subscribe.includes('rec.hidden = false'));
});
