/**
 * The homepage lists listed editions (vault ticket 06; spec — self-serve editions).
 *
 * The landing page is a shelf: one directory card per listed edition, earliest
 * first festival day first, then name. Unlisted and blocked editions never
 * appear. The whole card is the link to the edition's subscribe page in its
 * namespace; a fan edition carries the fan-made mark in its eyebrow. A card with
 * no committed image draws the Facets core, seeded by festival key. Every card
 * and tile on both page types shares the single 18px radius.
 *
 * Three fixture editions: harbor-lights-2026 (owner, August), pier-nine-2026
 * (fan, September), dst-check-2026 (owner, November). Nothing here reads the
 * clock or touches data/ or state/.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import type { Manifest, SiteManifest } from '../src/build.js';
import {
  facetsArt,
  listedEditions,
  renderLandingPage,
  renderSubscribePage,
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
  const html = renderLandingPage(twoListed());
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
  const html = renderLandingPage(site);
  assert.equal(cards(html).length, 1, 'one card, for the one edition that is listed and not blocked');
  assert.equal(html.includes('pier-nine'), false, 'the blocked edition is nowhere on the page');
});

test('landing: nothing listed renders no shelf at all, and the page still stands', () => {
  const site = buildFixtureSite([harborDoc(), pierDoc()]).site;
  const html = renderLandingPage(site);
  assert.equal(cards(html).length, 0, 'no card for an unlisted edition');
  assert.equal(html.includes('class="shelf'), false, 'no empty shelf, no orphan header');
  const text = visibleText(html);
  assert.ok(text.includes('Set times, by stage.'), 'the hero survives');
  assert.ok(text.includes('Unofficial. Not affiliated with any festival.'), 'the footer survives');
});

test('landing: a fan edition carries the fan-made mark in its eyebrow; an owner edition carries dates and city', () => {
  const [harbor, pier] = cards(renderLandingPage(twoListed())) as [string, string];
  assert.match(pier, /<span class="eyebrow eyebrow--fan">Fan-made<\/span>/, 'the fan mark takes the eyebrow slot');
  assert.doesNotMatch(harbor, /eyebrow--fan/, 'an owner edition shows no fan mark');
  assert.match(harbor, /<span class="eyebrow">Aug 14–16, 2026<\/span>/, 'dates only — the harbor fixture has no city');
  assert.ok(visibleText(pier).includes('Sep 19, 2026'), 'the fan card still says when');
});

test('landing: a city joins the eyebrow when the festival has one', () => {
  const withCity = docFromText(
    pierYamlText().replace('official_url:', 'city: "Brooklyn"\n  official_url:'),
    'pier-with-city',
  );
  assert.equal(withCity.festival.city, 'Brooklyn', 'the schema reads the optional city');
  const site = buildFixtureSite([withCity], { [PIER_PATH]: { listed: true } }).site;
  assert.equal(site.editions[0]!.festival.city, 'Brooklyn', 'the manifest carries the city');
  const html = renderLandingPage(site);
  assert.ok(visibleText(html).includes('Sep 19, 2026 · Brooklyn'), 'dates then city');
  // A city is display only: the feeds are the same bytes with or without it.
  const bare = buildFixtureSite([pierDoc()], { [PIER_PATH]: { listed: true } });
  const named = buildFixtureSite([withCity], { [PIER_PATH]: { listed: true } });
  for (const [rel, text] of bare.files) {
    if (rel.endsWith('.ics')) assert.equal(named.files.get(rel), text, `${rel} must not change with a city`);
  }
});

test('landing: the card is text first — eyebrow, name, one bold lead with the counts, then art', () => {
  const [harbor] = cards(renderLandingPage(twoListed())) as [string];
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

test('landing: the section header is two sentences on one line, bold lead and quiet tail, both ending in a period', () => {
  const html = renderLandingPage(twoListed());
  const m = /<h2 class="shelf-head"><span class="lead">([^<]+)<\/span> <span class="tail">([^<]+)<\/span><\/h2>/.exec(html);
  assert.ok(m, 'one h2 with a lead span and a tail span');
  const [, lead, tail] = m as unknown as [string, string, string];
  assert.match(lead, /^[A-Z][^.]*\.$/, 'the lead is one sentence ending in a period');
  assert.match(tail, /^[A-Z][^.]*\.$/, 'the tail is one sentence ending in a period');
  assert.ok(lead.split(' ').length <= 3, 'lead is at most three words');
  assert.ok(tail.split(' ').length <= 9, 'tail is at most nine words');
});

// ===========================================================================
// Art: a committed image wins; otherwise the Facets core, seeded by key
// ===========================================================================

test('landing: a card with no committed image draws the Facets core, and the same edition draws the same bytes', () => {
  const html1 = renderLandingPage(twoListed());
  const html2 = renderLandingPage(twoListed());
  assert.equal(html1, html2, 'byte-identical twice');
  const [harbor, pier] = cards(html1) as [string, string];
  assert.match(harbor, /<svg class="art-svg art-facets"/, 'harbor has no committed image, so the Facets core');
  assert.match(pier, /<svg class="art-svg art-facets"/, 'pier too');
  assert.equal(harbor.includes('<img'), false, 'no image element without a committed image');
  const idOf = (card: string) => /clipPath id="([^"]+)"/.exec(card)?.[1];
  assert.ok(idOf(harbor) && idOf(pier) && idOf(harbor) !== idOf(pier), 'clip ids are per edition, so two cards do not collide');
});

test('landing: an owner and a fan edition of the same festival-year share art but not a clip id', () => {
  const pier = pierDoc();
  const ownerPier = docFromText(pierYamlText().replace('namespace: fan', 'namespace: owner'), 'pier-as-owner');
  const site = buildFixtureSite([pier, ownerPier], {
    [PIER_PATH]: { listed: true },
    'pier-nine-2026': { listed: true },
  }).site;
  const found = cards(renderLandingPage(site));
  assert.equal(found.length, 2, 'both editions are listed');
  const ids = found.map((c) => /clipPath id="([^"]+)"/.exec(c)?.[1]);
  assert.ok(ids[0] && ids[1] && ids[0] !== ids[1], `one id per element in the document: ${ids.join(', ')}`);
  const tilts = found.map((c) => /rotate\((-?\d+) /.exec(c)?.[1]);
  assert.equal(tilts[0], tilts[1], 'the same festival key seeds the same tilt in both namespaces');
});

test('facetsArt: seeded by festival key — a different key is different art, the same key is the same art', () => {
  const a = facetsArt('harbor-lights-2026', '#C42408');
  const b = facetsArt('harbor-lights-2026', '#C42408');
  const c = facetsArt('pier-nine-2026', '#C42408');
  assert.equal(a, b, 'the same key draws the same bytes');
  assert.notEqual(a, c, 'a different key draws different art');
  assert.match(a, /rotate\(-?\d+ /, 'the tilt is seeded');
  assert.equal(a.includes('Math.random'), false, 'nothing random reaches the page');
  assert.match(a, /aria-hidden="true"/, 'decorative inside the card link');
});

test('landing: a committed festival image wins over the Facets core', () => {
  const html = renderLandingPage(twoListed(), { images: { 'harbor-lights-2026': '/assets/festivals/harbor-lights-2026.webp' } });
  const [harbor, pier] = cards(html) as [string, string];
  assert.match(harbor, /<img src="\/assets\/festivals\/harbor-lights-2026\.webp" alt="" loading="lazy">/, 'the committed image');
  assert.equal(harbor.includes('art-facets'), false, 'no fallback art beside an image');
  assert.match(pier, /art-facets/, 'the other card still falls back');
});

// ===========================================================================
// One radius, site-wide
// ===========================================================================

test('radius: both page types use the single 18px card radius and the media-card token is gone', () => {
  const site = twoListed();
  const landing = renderLandingPage(site);
  const subscribe = renderSubscribePage(site.editions[1]!);
  for (const [name, html] of [
    ['landing', landing],
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
  const html = renderLandingPage(twoListed());
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
  const html = renderLandingPage(twoListed());
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
  const text = visibleText(renderLandingPage(twoListed()));
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
