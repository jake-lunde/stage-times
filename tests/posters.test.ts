/**
 * The subscribe page's top area (owner, 2026-09-23): the sticky bar with the
 * wordmark home and the festival name, no back button; the eyebrow, the big
 * title and two plain lines; and the official posters — the festival's own
 * posted images, committed at assets/schedule/<key>/, one tile per day and a
 * lightbox on tap — so a reader can check the times before adding a calendar.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildFeeds } from '../src/build.js';
import { committedPosters, dayLabel, renderBlockedPage, renderSitePages, renderSubscribePage } from '../src/pages.js';
import { PIER_PATH, buildFixtureSite, emptyState, harborDoc, pierDoc, visibleText } from './helpers.js';

const harbor = buildFeeds(harborDoc(), emptyState('20260808T000000Z')).manifest;
const posters = [
  { src: '/assets/schedule/harbor-lights-2026/2026-08-07.webp', label: 'Fri 7 Aug' },
  { src: '/assets/schedule/harbor-lights-2026/2026-08-08.webp', label: 'Sat 8 Aug' },
];

// ===========================================================================
// The sticky bar and the top area
// ===========================================================================

test('top area: the sticky bar carries the wordmark home and the festival name, and there is no back button', () => {
  const html = renderSubscribePage(harbor);
  assert.match(html, /<nav class="bar" data-watch>\s*<div class="bar-in">\s*<a class="bar-home" href="\/" aria-label="Stage Times home">Stage&nbsp;Times<\/a>\s*<span class="bar-title">Harbor Lights Festival <span class="year">2026<\/span><\/span>/);
  assert.match(html, /\.bar\{position:sticky; top:0; z-index:10; background:var\(--paper\)\}/, 'sticks to the top in the page color');
  assert.doesNotMatch(html, /class="topbar"/, 'the old top bar is gone');
  assert.doesNotMatch(html, /<a class="icon-btn" href="\/"/, 'no back button');
  assert.match(html, /\.bar\[data-watch\] \.bar-title\{opacity:0\}/, 'the name is hidden until the title scrolls out');
  assert.match(html, /new IntersectionObserver/, 'the script watches the title');
});

test('top area: eyebrow of days (and city when there is one), the title with its year, then the counts and the one-line invitation', () => {
  const text = visibleText(renderSubscribePage(harbor));
  assert.match(text, /Stage Times Harbor Lights Festival 2026 Fri 14 Aug – Sun 16 Aug Harbor Lights Festival 2026 84 sets across 6 stages\. One calendar per stage\. Add the ones you want\./);
  assert.doesNotMatch(text, /84 sets · 6 stages/, 'the old mono caption is gone');
  const withCity = visibleText(renderSubscribePage({ ...harbor, festival: { ...harbor.festival, city: 'Portland' } }));
  assert.match(withCity, /Fri 14 Aug – Sun 16 Aug · Portland Harbor Lights Festival 2026/);
});

test('top area: the blocked page keeps the bar, statically, and the title', () => {
  const site = buildFixtureSite([pierDoc()], { [PIER_PATH]: { blocked: true } }).site;
  const html = renderBlockedPage(site.editions[0]!);
  assert.match(html, /<nav class="bar">/, 'no scroll watch on the removed page');
  assert.match(html, /aria-label="Stage Times home"/);
  assert.doesNotMatch(html, /class="topbar"/);
});

// ===========================================================================
// The official posters
// ===========================================================================

test('dayLabel: an ISO date becomes the weekday, day and month', () => {
  assert.equal(dayLabel('2026-08-07'), 'Fri 7 Aug');
  assert.equal(dayLabel('2026-10-11'), 'Sun 11 Oct');
  assert.equal(dayLabel('2027-01-01'), 'Fri 1 Jan');
});

test('committedPosters: the images under assets/schedule/<key>/, in file order, captioned by their date', () => {
  const dir = mkdtempSync(join(tmpdir(), 'st-posters-'));
  try {
    const key = 'harbor-lights-2026';
    mkdirSync(join(dir, 'schedule', key), { recursive: true });
    for (const f of ['2026-08-08.webp', '2026-08-07.webp', 'notes.txt', 'grid.png', '.DS_Store']) {
      writeFileSync(join(dir, 'schedule', key, f), '');
    }
    const site = buildFixtureSite([harborDoc(), pierDoc()]).site;
    const found = committedPosters(site, dir);
    assert.deepEqual(found, {
      [key]: [
        { src: `/assets/schedule/${key}/2026-08-07.webp`, label: 'Fri 7 Aug' },
        { src: `/assets/schedule/${key}/2026-08-08.webp`, label: 'Sat 8 Aug' },
        { src: `/assets/schedule/${key}/grid.png`, label: 'grid' },
      ],
    });
    assert.equal('pier-nine-2026' in found, false, 'an edition with no folder has no entry');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('official posters: one tile per day in a row under the title, each a link to the image, and one lightbox', () => {
  const html = renderSubscribePage(harbor, { posters });
  const text = visibleText(html);
  assert.match(text, /Official posters Fri 7 Aug Sat 8 Aug Tap a day to check the times\./);
  assert.match(html, /\.posters\{[^}]*overflow-x:auto; scroll-snap-type:x mandatory/, 'one horizontal row, the carousel pattern');
  assert.match(html, /<dialog class="lightbox" aria-label="Official posters">/);
  assert.match(html, /<a class="poster" href="\/assets\/schedule\/harbor-lights-2026\/2026-08-07\.webp" data-poster="0"><img src="\/assets\/schedule\/harbor-lights-2026\/2026-08-07\.webp" alt="" loading="lazy"><span class="poster-day">Fri 7 Aug<\/span><\/a>/);
  assert.equal((html.match(/class="poster"/g) ?? []).length, 2);
  assert.equal((html.match(/<dialog class="lightbox"/g) ?? []).length, 1);
  assert.match(html, /<button class="icon-btn" data-lb-close aria-label="Close">/, 'an X, not a label');
  assert.match(html, /aria-label="Previous day"/);
  assert.match(html, /aria-label="Next day"/);
  assert.match(html, /\.poster img\{[^}]*border-radius:var\(--r-card\)/, 'tiles take the one radius');
  assert.match(html, /\.poster:active\{transform:var\(--press\)\}/, 'tiles shrink on press');
  assert.doesNotMatch(html, /box-shadow|linear-gradient/);
});

test('official posters: one day has no previous and next; no posters, no tiles and no lightbox', () => {
  const one = renderSubscribePage(harbor, { posters: posters.slice(0, 1) });
  assert.match(one, /<dialog class="lightbox"/);
  assert.doesNotMatch(one, /class="lb-nav"/);

  const none = renderSubscribePage(harbor);
  assert.doesNotMatch(none, /class="poster"/);
  assert.doesNotMatch(none, /<dialog/);
  assert.doesNotMatch(visibleText(none), /Official posters/);
});

test('official posters: the site build finds the committed images and puts them on the edition page', () => {
  const assets = mkdtempSync(join(tmpdir(), 'st-assets-'));
  const out = mkdtempSync(join(tmpdir(), 'st-out-'));
  try {
    mkdirSync(join(assets, 'schedule', 'harbor-lights-2026'), { recursive: true });
    writeFileSync(join(assets, 'schedule', 'harbor-lights-2026', '2026-08-07.webp'), '');
    const site = buildFixtureSite([harborDoc(), pierDoc()]).site;
    renderSitePages(site, out, { assetsDir: assets });
    const harborHtml = readFileSync(join(out, 'harbor-lights-2026', 'index.html'), 'utf8');
    const pierHtml = readFileSync(join(out, PIER_PATH, 'index.html'), 'utf8');
    assert.match(harborHtml, /data-poster="0"/);
    assert.doesNotMatch(pierHtml, /data-poster="/);
    assert.ok(existsSync(join(out, 'assets', 'schedule', 'harbor-lights-2026', '2026-08-07.webp')), 'copied with the assets');
  } finally {
    rmSync(assets, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  }
});
