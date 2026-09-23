/**
 * The homepage lists listed editions (vault ticket 06; spec — self-serve editions).
 *
 * The landing page is two shelves: one directory card per listed edition,
 * earliest first festival day first, then name, all built onto the first
 * shelf; the page itself moves the ones whose last day has passed to the
 * second shelf, latest first, because the build never reads a clock.
 * Unlisted and blocked editions never appear. The whole card is the link to the edition's subscribe page in its
 * namespace; no card says whose it is (ADR-0005). A card's art is the
 * festival's own committed image; a listed edition without one stays off the
 * shelf (owner, 2026-09-22). Every card and tile on both page types shares the
 * single 18px radius.
 *
 * Three fixture editions: harbor-lights-2026 (owner, August), pier-nine-2026
 * (fan, September), dst-check-2026 (owner, November). Nothing here reads the
 * clock or touches data/ or state/.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import type { Manifest, SiteManifest } from '../src/build.js';
import {
  LANDING_SCRIPT,
  listedEditions,
  renderLandingPage,
  renderSubscribePage,
  shelvedEditions,
  shortDates,
} from '../src/pages.js';
import {
  HARBOR_PATH,
  PIER_PATH,
  buildFixtureSite,
  docFromText,
  dstDoc,
  harborDoc,
  pierDoc,
  pierYamlText,
  visibleText,
} from './helpers.js';

/** Every directory card on the page, in document order, as its outer HTML. */
function cards(html: string): string[] {
  return html.match(/<a class="shelf-card"[\s\S]*?<\/a>/g) ?? [];
}

/** Committed festival art for every fixture edition, as the build would find it. */
const COVERS: Record<string, string> = {
  'harbor-lights-2026': '/assets/festivals/harbor-lights-2026.webp',
  'pier-nine-2026': '/assets/festivals/pier-nine-2026.jpg',
  'dst-check-2026': '/assets/festivals/dst-check-2026.png',
};

/** The homepage with every fixture's art committed. */
function landing(site: SiteManifest): string {
  return renderLandingPage(site, { images: COVERS });
}

function twoListed(): SiteManifest {
  return buildFixtureSite([harborDoc(), pierDoc(), dstDoc()], {
    [HARBOR_PATH]: { listed: true },
    [PIER_PATH]: { listed: true },
  }).site;
}

// ===========================================================================
// Which editions, in what order
// ===========================================================================

test('listedEditions: only listed, unblocked editions, earliest first day first', () => {
  const site = twoListed();
  assert.equal(site.editions.length, 3, 'three fixture editions build');
  const listed = listedEditions(site);
  assert.deepEqual(
    listed.map((m) => m.festival.basePath),
    ['/harbor-lights-2026', '/fan/pier-nine-2026'],
    'harbor (August) before pier (September); dst (unlisted) absent',
  );
});

test('listedEditions: a blocked-but-listed edition is not listed', () => {
  const site = buildFixtureSite([harborDoc(), pierDoc()], {
    [HARBOR_PATH]: { listed: true },
    [PIER_PATH]: { listed: true, blocked: true },
  }).site;
  assert.deepEqual(
    listedEditions(site).map((m) => m.festival.basePath),
    ['/harbor-lights-2026'],
    'the blocked edition is out whatever its listed flag says',
  );
});

test('listedEditions: editions sharing a first day sort by name', () => {
  const site = twoListed();
  const [harbor, pier] = listedEditions(site) as [Manifest, Manifest];
  // Give pier harbor's first day and a name that sorts before it.
  const sameDay: Manifest = {
    ...pier,
    festival: { ...pier.festival, name: 'Aardvark Weekender' },
    all: { ...pier.all, dayspan: { ...harbor.all.dayspan } },
  };
  const reordered = listedEditions({ editions: [harbor, sameDay] });
  assert.deepEqual(
    reordered.map((m) => m.festival.name),
    ['Aardvark Weekender', 'Harbor Lights Festival'],
    'same first day: name decides',
  );
});

// ===========================================================================
// The page: card count, links, the fan mark
// ===========================================================================

test('landing: exactly one card per listed edition, in order, each the link to its subscribe page', () => {
  const html = landing(twoListed());
  const found = cards(html);
  assert.equal(found.length, 2, 'two listed editions, two cards');
  assert.match(found[0]!, /^<a class="shelf-card" href="\/harbor-lights-2026\/"/, 'harbor first, owner namespace');
  assert.match(found[1]!, /^<a class="shelf-card" href="\/fan\/pier-nine-2026\/"/, 'pier second, fan namespace');
  assert.equal(html.includes('dst-check-2026'), false, 'the unlisted edition is nowhere on the page');
  assert.equal(html.includes('<button'), false, 'no button inside a card — the card is the link');
  assert.equal(html.includes('See stages'), false, 'the old featured-card pill is gone');
});

test('landing: a blocked-but-listed edition renders no card', () => {
  const site = buildFixtureSite([harborDoc(), pierDoc()], {
    [HARBOR_PATH]: { listed: true },
    [PIER_PATH]: { listed: true, blocked: true },
  }).site;
  const html = landing(site);
  assert.equal(cards(html).length, 1, 'one card, for the one edition that is listed and not blocked');
  assert.equal(html.includes('pier-nine'), false, 'the blocked edition is nowhere on the page');
});

test('landing: nothing listed renders no shelf at all, and the page still stands', () => {
  const site = buildFixtureSite([harborDoc(), pierDoc()]).site;
  const html = landing(site);
  assert.equal(cards(html).length, 0, 'no card for an unlisted edition');
  assert.equal(html.includes('class="shelf'), false, 'no empty shelf, no orphan header');
  const text = visibleText(html);
  assert.ok(text.includes('Set times, by stage.'), 'the hero survives');
  assert.ok(text.includes('Unofficial. Not affiliated with any festival.'), 'the footer survives');
});

test('landing: every card carries its dates in the eyebrow, and none says whose it is (ADR-0005)', () => {
  const [harbor, pier] = cards(landing(twoListed())) as [string, string];
  assert.match(harbor, /<span class="eyebrow">Aug 14–16, 2026<\/span>/, 'dates only — the harbor fixture has no city');
  assert.match(pier, /<span class="eyebrow">Sep 19, 2026<\/span>/, 'an edition from before the change reads the same');
  for (const card of [harbor, pier]) assert.doesNotMatch(card, /Fan-made|eyebrow--fan/);
});

test('landing: a city joins the eyebrow when the festival has one', () => {
  const withCity = docFromText(
    pierYamlText().replace('official_url:', 'city: "Brooklyn"\n  official_url:'),
    'pier-with-city',
  );
  assert.equal(withCity.festival.city, 'Brooklyn', 'the schema reads the optional city');
  const site = buildFixtureSite([withCity], { [PIER_PATH]: { listed: true } }).site;
  assert.equal(site.editions[0]!.festival.city, 'Brooklyn', 'the manifest carries the city');
  const html = landing(site);
  assert.ok(visibleText(html).includes('Sep 19, 2026 · Brooklyn'), 'dates then city');
  // A city is display only: the feeds are the same bytes with or without it.
  const bare = buildFixtureSite([pierDoc()], { [PIER_PATH]: { listed: true } });
  const named = buildFixtureSite([withCity], { [PIER_PATH]: { listed: true } });
  for (const [rel, text] of bare.files) {
    if (rel.endsWith('.ics')) assert.equal(named.files.get(rel), text, `${rel} must not change with a city`);
  }
});

test('landing: the card is text first — eyebrow, name, one bold lead with the counts, then art', () => {
  const [harbor] = cards(landing(twoListed())) as [string];
  const m = listedEditions(twoListed())[0]!;
  const order = ['class="eyebrow"', 'class="shelf-title"', 'class="shelf-lead"', 'class="shelf-meta"', 'class="shelf-art"'];
  const positions = order.map((needle) => harbor.indexOf(needle));
  assert.ok(positions.every((p) => p >= 0), `every slot present: ${positions.join(',')}`);
  assert.deepEqual([...positions].sort((a, b) => a - b), positions, 'slots in order, art last');
  assert.ok(harbor.includes(`<span class="shelf-title">${m.festival.name}</span>`), 'the title is the festival name');
  assert.ok(
    harbor.includes(`<span class="shelf-lead">${m.allSetCount} sets across ${m.stages.length} stages.</span>`),
    'the lead is the set and stage counts',
  );
  assert.ok(
    harbor.includes(`<span class="shelf-meta">${m.stages[0]!.headliners.join(' · ')}</span>`),
    'the quiet line is the first stage’s billed headliners',
  );
});

test('landing: every section header is two sentences on one line, bold lead and quiet tail, both ending in a period', () => {
  const html = landing(twoListed());
  const heads = [...html.matchAll(/<h2 class="shelf-head"><span class="lead">([^<]+)<\/span> <span class="tail">([^<]+)<\/span><\/h2>/g)];
  assert.equal(heads.length, 2, 'two shelves, two headers: what is coming and what has happened');
  for (const [, lead, tail] of heads as unknown as [string, string, string][]) {
    assert.match(lead, /^[A-Z][^.]*\.$/, 'the lead is one sentence ending in a period');
    assert.match(tail, /^[A-Z][^.]*\.$/, 'the tail is one sentence ending in a period');
    assert.ok(lead.split(' ').length <= 3, 'lead is at most three words');
    assert.ok(tail.split(' ').length <= 9, 'tail is at most nine words');
  }
});

// ===========================================================================
// Two shelves: coming, soonest first; happened, sorted by the page, not the build
// ===========================================================================

test('landing: every card is built onto the coming shelf with its first and last day; the happened shelf ships empty and hidden', () => {
  const site = twoListed();
  const html = landing(site);
  const coming = /<section class="shelf-section" data-shelf="coming">[\s\S]*?<\/section>/.exec(html)?.[0];
  const past = /<section class="shelf-section" data-shelf="past" hidden>[\s\S]*?<\/section>/.exec(html)?.[0];
  assert.ok(coming, 'the coming shelf');
  assert.ok(past, 'the happened shelf, hidden until the page finds something for it');
  assert.ok(html.indexOf(coming!) < html.indexOf(past!), 'coming first, happened below');
  assert.equal(cards(coming!).length, 2, 'every card starts on the coming shelf');
  assert.equal(cards(past!).length, 0, 'nothing on the happened shelf: the build never reads a clock');
  assert.match(past!, /<ul class="shelf"><\/ul>/, 'an empty shelf for the page to fill');
  const days = [...coming!.matchAll(/<li data-first="(\d{4}-\d{2}-\d{2})" data-last="(\d{4}-\d{2}-\d{2})">/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(
    days,
    listedEditions(site).map((m) => [m.all.dayspan.first, m.all.dayspan.last]),
    'each card carries its edition’s first and last day, soonest first',
  );
});

test('landing: the page moves what has happened, by the device date, and the build ships the script only with a shelf', () => {
  const html = landing(twoListed());
  assert.ok(html.includes(LANDING_SCRIPT), 'the shelving script is on the page');
  for (const needle of ['new Date()', 'li[data-last]', "data-shelf=\"coming\"", "data-shelf=\"past\"", 'past.hidden = false']) {
    assert.ok(LANDING_SCRIPT.includes(needle), `the script ${needle}`);
  }
  assert.equal(html.split('Date(').length, LANDING_SCRIPT.split('Date(').length, 'the only clock on the page is the shelving one');
  const empty = renderLandingPage(buildFixtureSite([harborDoc(), pierDoc()]).site);
  assert.equal(empty.includes('data-shelf'), false, 'nothing listed: no shelf either way');
  assert.equal(empty.includes(LANDING_SCRIPT), false, 'and nothing to sort');
});

// ===========================================================================
// Art: the festival's own, or the edition waits off the shelf
// ===========================================================================

test('landing: the card art is the festival’s committed image, and the build draws none of its own', () => {
  const [harbor, pier] = cards(landing(twoListed())) as [string, string];
  assert.match(harbor, /<span class="shelf-art" style="background:#[0-9a-f]{6}"><img src="\/assets\/festivals\/harbor-lights-2026\.webp" alt="" loading="lazy"><\/span>/i, 'the committed image, on a light ground while it loads');
  assert.match(pier, /<img src="\/assets\/festivals\/pier-nine-2026\.jpg"/, 'whatever the extension');
  for (const card of [harbor, pier]) assert.equal(card.includes('<svg'), false, 'no generated art on a directory card');
});

test('landing: a listed edition without its festival art stays off the shelf', () => {
  const html = renderLandingPage(twoListed(), { images: { 'harbor-lights-2026': COVERS['harbor-lights-2026']! } });
  const found = cards(html);
  assert.equal(found.length, 1, 'only the edition with its art');
  assert.match(found[0]!, /href="\/harbor-lights-2026\/"/);
  assert.equal(html.includes('pier-nine'), false, 'the edition without art is nowhere on the page');
});

test('landing: listed editions with no art at all render no shelf, and the page still stands', () => {
  const html = renderLandingPage(twoListed());
  assert.equal(html.includes('class="shelf'), false, 'no empty shelf, no orphan header');
  assert.ok(visibleText(html).includes('Set times, by stage.'), 'the hero survives');
});

test('shelvedEditions: the listed editions with art, in listed order', () => {
  const site = twoListed();
  assert.deepEqual(
    shelvedEditions(site, COVERS).map((m) => m.festival.basePath),
    listedEditions(site).map((m) => m.festival.basePath),
    'every listed edition has art: the shelf is the listed order',
  );
  assert.deepEqual(
    shelvedEditions(site, { 'pier-nine-2026': COVERS['pier-nine-2026']!, 'dst-check-2026': COVERS['dst-check-2026']! }).map((m) => m.festival.basePath),
    ['/fan/pier-nine-2026'],
    'art on an unlisted edition does not list it',
  );
});

// ===========================================================================
// One radius, site-wide
// ===========================================================================

test('radius: both page types use the single 18px card radius and the media-card token is gone', () => {
  const site = twoListed();
  const landingHtml = landing(site);
  const subscribe = renderSubscribePage(site.editions[1]!);
  for (const [name, html] of [
    ['landing', landingHtml],
    ['subscribe', subscribe],
  ] as const) {
    assert.ok(html.includes('--r-card:18px'), `${name}: the one radius`);
    assert.equal(html.includes('r-card-media'), false, `${name}: the retired token`);
    assert.doesNotMatch(html, /border-radius:\s*(16|24)px/, `${name}: no card at the old radii`);
  }
});

// ===========================================================================
// Density and the checklist
// ===========================================================================

test('landing: the shelf density tokens are the Store’s, and the shelf is CSS scroll-snap', () => {
  const html = landing(twoListed());
  for (const token of ['--pad-shelf:28px', '--gap-shelf:20px', '--h-shelf-card:450px', '--gap-section:clamp(48px, 6vw, 64px)']) {
    assert.ok(html.includes(token), token);
  }
  assert.match(html, /\.shelf\{[^}]*scroll-snap-type:x mandatory/, 'CSS scroll-snap, no JS');
  assert.match(html, /\.shelf\{[^}]*scrollbar-width:none/, 'the peek is the affordance, not a scrollbar');
  assert.match(html, /\.shelf\{[^}]*max-width:980px/, 'a shelf spans at most the Store’s 980');
  assert.match(html, /--w-shelf-card:calc\(100vw - 2 \* var\(--margin\) - 24px\)/, 'one card owns a phone with a 24px peek');
  assert.match(html, /--h-shelf-card:500px/, 'taller from tablet up');
});

test('landing: no shadow, no gradient, no third-party request, fonts self-hosted', () => {
  const html = landing(twoListed());
  assert.equal(html.includes('box-shadow'), false, 'no shadow anywhere');
  assert.equal(html.includes('gradient'), false, 'no gradient anywhere');
  const urls = html.match(/(?:src|href)="(https?:)?\/\/[^"]+"/g) ?? [];
  for (const u of urls) {
    assert.ok(u.includes('github.com/jake-lunde/stage-times/issues'), `unexpected external reference: ${u}`);
  }
  assert.ok(html.includes('/assets/fonts/archivo-var-latin.woff2'), 'Archivo from the same origin');
  assert.ok(html.includes('/assets/fonts/fragment-mono-latin.woff2'), 'Fragment Mono from the same origin');
});

test('landing: every string passes the copy rules', () => {
  const text = visibleText(landing(twoListed()));
  assert.doesNotMatch(text, /\b(we|we're|we've|our|ours|us)\b/i, 'no corporate first person');
  assert.doesNotMatch(text, /\b(listed|edition|feed|feeds|subscribe|namespace|upload)\b/i, 'no glossary or machinery word');
  assert.equal(text.includes('!'), false, 'no exclamation marks');
});

// ===========================================================================
// The short date form
// ===========================================================================

test('shortDates: one month, two months, one day, two years', () => {
  assert.equal(shortDates('2026-08-07', '2026-08-09'), 'Aug 7–9, 2026', 'one month');
  assert.equal(shortDates('2026-08-30', '2026-09-01'), 'Aug 30 – Sep 1, 2026', 'two months');
  assert.equal(shortDates('2026-09-19', '2026-09-19'), 'Sep 19, 2026', 'one day');
  assert.equal(shortDates('2026-12-31', '2027-01-01'), 'Dec 31, 2026 – Jan 1, 2027', 'two years');
});
