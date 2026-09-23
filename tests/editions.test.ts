/**
 * Editions: every edition builds, in its own namespace, with listed and blocked
 * state from committed state (vault ticket 04; spec — self-serve editions;
 * ADR-0001).
 *
 * The build seam: YAML fixtures plus committed state in, files out. Two fixture
 * editions — harbor-lights-2026 (owner) and pier-nine-2026 (fan) — build side by
 * side; the fan one is also the one these tests block. Nothing here touches the
 * real data/ or state/, and nothing reads the clock.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ICAL from 'ical.js';

import {
  assertPublishedEditionsPresent,
  buildSite,
  editionPathOf,
  readPublished,
  readSequences,
  run,
  stableJson,
  type PublishedFile,
} from '../src/build.js';
import { SchemaError } from '../src/schema.js';
import { renderBlockedPage, renderSitePages, type SiteManifest } from '../src/pages.js';
import {
  GOLDEN_PUBLISHED_AT,
  HARBOR_FIXTURE_PATH,
  HARBOR_PATH,
  PIER_FIXTURE_PATH,
  PIER_PATH,
  REPO_ROOT,
  buildFixtureSite,
  docFromText,
  emptySequences,
  harborDoc,
  pierDoc,
  pierYamlText,
  publishedFor,
  recordFor,
  visibleText,
} from './helpers.js';

const harbor = harborDoc();
const pier = pierDoc();

function parseIcs(text: string): ICAL.Component {
  return new ICAL.Component(ICAL.parse(text));
}

// ===========================================================================
// Namespace: declared in the YAML, validated by the schema
// ===========================================================================

test('namespace: the owner fixture builds to the root, the fan fixture under /fan/', () => {
  assert.equal(harbor.namespace, 'owner');
  assert.equal(pier.namespace, 'fan');
  assert.equal(editionPathOf(harbor), HARBOR_PATH);
  assert.equal(editionPathOf(pier), PIER_PATH);
});

test('namespace: a YAML without one is refused — the root is never claimed by omission', () => {
  const text = pierYamlText().replace('\nnamespace: fan\n', '\n');
  assert.doesNotMatch(text, /^namespace:/m, 'mutation must remove the field');
  assert.throws(
    () => docFromText(text, 'pier (no namespace)'),
    (err: Error) => {
      assert.ok(err instanceof SchemaError);
      assert.match(err.message, /`namespace` is required/);
      assert.match(err.message, /\/fan\/pier-nine-2026\//);
      return true;
    },
  );
});

test('namespace: anything but "owner" or "fan" is refused', () => {
  for (const bad of ['"public"', 'true', '"Fan"', '"/fan/"']) {
    assert.throws(
      () => docFromText(pierYamlText().replace('namespace: fan', `namespace: ${bad}`), `pier (${bad})`),
      /`namespace` must be "owner" or "fan"/,
      `namespace ${bad}`,
    );
  }
});

// ===========================================================================
// Two editions, both namespaces, side by side, byte-identical twice
// ===========================================================================

test('editions: owner and fan fixtures build side by side to their own paths', () => {
  const site = buildFixtureSite([harbor, pier]);
  const paths = [...site.files.keys()].sort();

  for (const stage of harbor.stages) assert.ok(paths.includes(`${HARBOR_PATH}/${stage.id}.ics`), stage.id);
  assert.ok(paths.includes(`${HARBOR_PATH}/all.ics`));
  for (const stage of pier.stages) assert.ok(paths.includes(`${PIER_PATH}/${stage.id}.ics`), stage.id);
  assert.ok(paths.includes(`${PIER_PATH}/all.ics`));
  assert.ok(paths.includes('feeds.json'));
  assert.equal(paths.length, harbor.stages.length + 1 + pier.stages.length + 1 + 1, 'nothing else is emitted');

  // Nothing from one edition leaks into the other's directory.
  assert.equal(paths.some((p) => p.startsWith('pier-nine-2026/')), false, 'a fan edition never lands at the root');
  assert.equal(paths.some((p) => p.startsWith('fan/harbor')), false, 'an owner edition never lands under /fan/');

  const [pierManifest, harborManifest] = site.site.editions;
  assert.equal(pierManifest!.festival.basePath, '/fan/pier-nine-2026');
  assert.equal(pierManifest!.stages[0]!.icsPath, '/fan/pier-nine-2026/pier.ics');
  assert.equal(pierManifest!.all.icsPath, '/fan/pier-nine-2026/all.ics');
  assert.equal(harborManifest!.festival.basePath, '/harbor-lights-2026');
});

test('editions: two consecutive builds of both fixtures are byte-identical', () => {
  const first = buildFixtureSite([harbor, pier]);
  const second = buildFixtureSite([pier, harbor]);
  assert.deepEqual([...second.files.keys()].sort(), [...first.files.keys()].sort());
  for (const [path, text] of first.files) {
    assert.ok(
      Buffer.from(text, 'utf8').equals(Buffer.from(second.files.get(path)!, 'utf8')),
      `${path} is not byte-identical across two builds`,
    );
  }
  assert.equal(stableJson(second.nextSequences), stableJson(first.nextSequences));
  assert.equal(stableJson(second.nextPublished), stableJson(first.nextPublished));
});

test('editions: the fan feed is a real calendar with the fan edition\'s own sets', () => {
  const site = buildFixtureSite([harbor, pier]);
  const comp = parseIcs(site.files.get(`${PIER_PATH}/pier.ics`)!);
  assert.equal(comp.getFirstPropertyValue('x-wr-calname'), "Pier Stage — Pier Nine 26");
  const summaries = comp.getAllSubcomponents('vevent').map((v) => String(v.getFirstPropertyValue('summary')));
  assert.deepEqual(summaries, ['Gull Season', 'Marina Ok', 'THE FERRY LIGHTS']);
});

test('editions: two editions on the same URL path are refused', () => {
  const twin = docFromText(readFileSync(HARBOR_FIXTURE_PATH, 'utf8'), 'harbor twin');
  assert.throws(() => buildFixtureSite([harbor, twin]), /same URL path "\/harbor-lights-2026\/"/);
});

// ===========================================================================
// Committed state: listed and blocked beside the stage-slug ledger
// ===========================================================================

test('state: an edition with no record builds unlisted and unblocked, and gets a record written', () => {
  const site = buildSite([harbor, pier], { publishedAt: GOLDEN_PUBLISHED_AT, editions: {} }, emptySequences(), GOLDEN_PUBLISHED_AT);
  for (const m of site.site.editions) {
    assert.equal(m.listed, false, `${m.festival.basePath}: listing is a human act, never the build's`);
    assert.equal(m.blocked, false);
  }
  assert.deepEqual(Object.keys(site.nextPublished.editions), [PIER_PATH, HARBOR_PATH]);
  assert.deepEqual(site.nextPublished.editions[PIER_PATH], {
    slug: 'pier-nine',
    year: 2026,
    namespace: 'fan',
    listed: false,
    blocked: false,
    stages: ['boathouse', 'pier'],
  });
});

test('state: listed and blocked flags flow from state into the manifest; the build never rewrites them', () => {
  const site = buildFixtureSite([harbor, pier], {
    [HARBOR_PATH]: { listed: true },
    [PIER_PATH]: { listed: true, blocked: true },
  });
  const [pierManifest, harborManifest] = site.site.editions;
  assert.equal(harborManifest!.listed, true);
  assert.equal(harborManifest!.blocked, false);
  assert.equal(pierManifest!.blocked, true);
  assert.equal(pierManifest!.listed, false, 'a blocked edition is never listed, whatever state says');
  assert.equal(pierManifest!.namespace, 'fan');
  assert.equal(harborManifest!.namespace, 'owner');

  // State keeps the human's flags verbatim, so reverting the block restores the listing.
  assert.equal(site.nextPublished.editions[PIER_PATH]!.listed, true);
  assert.equal(site.nextPublished.editions[PIER_PATH]!.blocked, true);
});

test('state: the stage ledger is append-only and merges across editions independently', () => {
  const site = buildFixtureSite([harbor, pier], {
    [PIER_PATH]: { stages: ['pier'] },
    [HARBOR_PATH]: { stages: ['main', 'grove'] },
  });
  assert.deepEqual(site.nextPublished.editions[PIER_PATH]!.stages, ['boathouse', 'pier']);
  assert.deepEqual(site.nextPublished.editions[HARBOR_PATH]!.stages, ['annex', 'canal', 'grove', 'main', 'porch', 'warehouse']);
});

test('gate 4: a published slug that disappears from ANY edition fails the build — the fan one included', () => {
  const published = publishedFor([harbor, pier], { [PIER_PATH]: { stages: ['pier', 'boathouse', 'old-dock'] } });
  assert.throws(
    () => buildSite([harbor, pier], published, emptySequences(), GOLDEN_PUBLISHED_AT),
    (err: Error) => {
      assert.match(err.message, /BUILD REFUSED/);
      assert.match(err.message, /https:\/\/stagetimes\.app\/fan\/pier-nine-2026\/old-dock\.ics/);
      return true;
    },
  );
});

test('gate 4: a published slug missing from a BLOCKED edition still fails the build', () => {
  const published = publishedFor([harbor, pier], { [PIER_PATH]: { blocked: true, stages: ['pier', 'boathouse', 'old-dock'] } });
  assert.throws(() => buildSite([harbor, pier], published, emptySequences(), GOLDEN_PUBLISHED_AT), /old-dock/);
});

test('gate 4: an edition recorded in state with no YAML at its path fails the build', () => {
  const published = publishedFor([harbor, pier]);
  assert.throws(
    () => assertPublishedEditionsPresent(published, [harbor]),
    (err: Error) => {
      assert.match(err.message, /PUBLISHED EDITION DISAPPEARED/);
      assert.match(err.message, /https:\/\/stagetimes\.app\/fan\/pier-nine-2026\//);
      assert.match(err.message, /blocked: true/);
      return true;
    },
  );
  assert.throws(() => buildSite([harbor], published, emptySequences(), GOLDEN_PUBLISHED_AT), /PUBLISHED EDITION DISAPPEARED/);
});

test('gate 4: changing an edition\'s namespace is caught as a moved edition, and named as such', () => {
  const moved = docFromText(pierYamlText().replace('namespace: fan', 'namespace: owner'), 'pier (moved to root)');
  const published = publishedFor([harbor, pier]);
  assert.throws(
    () => buildSite([harbor, moved], published, emptySequences(), GOLDEN_PUBLISHED_AT),
    (err: Error) => {
      assert.match(err.message, /declares `namespace: owner` but this edition was published as `fan`/);
      assert.match(err.message, /never moves between namespaces/);
      return true;
    },
  );
});

// ===========================================================================
// Blocked: every feed URL ever served, valid, empty, name intact
// ===========================================================================

const openSite = buildFixtureSite([harbor, pier], { [PIER_PATH]: { listed: true } });
const blockedSite = buildFixtureSite([harbor, pier], { [PIER_PATH]: { listed: true, blocked: true } });

test('blocked: every feed URL the edition ever served is still emitted', () => {
  const before = [...openSite.files.keys()].filter((p) => p.startsWith(`${PIER_PATH}/`)).sort();
  const after = [...blockedSite.files.keys()].filter((p) => p.startsWith(`${PIER_PATH}/`)).sort();
  assert.deepEqual(after, before);
  assert.deepEqual(after, [`${PIER_PATH}/all.ics`, `${PIER_PATH}/boathouse.ics`, `${PIER_PATH}/pier.ics`]);
});

test('blocked: each feed parses as a valid calendar with zero events and the original calendar name', () => {
  for (const rel of [`${PIER_PATH}/pier.ics`, `${PIER_PATH}/boathouse.ics`, `${PIER_PATH}/all.ics`]) {
    const open = parseIcs(openSite.files.get(rel)!);
    const blocked = parseIcs(blockedSite.files.get(rel)!);
    assert.equal(blocked.name, 'vcalendar', rel);
    assert.equal(blocked.getFirstPropertyValue('version'), '2.0', rel);
    assert.equal(blocked.getFirstPropertyValue('prodid'), '-//Stage Times//stagetimes.app//EN', rel);
    assert.equal(blocked.getAllSubcomponents('vevent').length, 0, `${rel}: no events while blocked`);
    assert.ok(open.getAllSubcomponents('vevent').length > 0, `${rel}: the unblocked feed has events`);
    assert.equal(blocked.getFirstPropertyValue('x-wr-calname'), open.getFirstPropertyValue('x-wr-calname'), `${rel}: X-WR-CALNAME intact`);
    assert.equal(blocked.getFirstPropertyValue('name'), open.getFirstPropertyValue('name'), `${rel}: NAME intact`);
    assert.equal(blocked.getFirstPropertyValue('x-wr-caldesc'), open.getFirstPropertyValue('x-wr-caldesc'), rel);
    assert.equal(blocked.getAllSubcomponents('vtimezone').length, 1, `${rel}: VTIMEZONE still present`);
    assert.ok(blockedSite.files.get(rel)!.endsWith('END:VCALENDAR\r\n'), rel);
  }
  assert.equal(
    parseIcs(blockedSite.files.get(`${PIER_PATH}/boathouse.ics`)!).getFirstPropertyValue('x-wr-calname'),
    'The Boathouse — Pier Nine 26',
  );
});

test('blocked: the other edition is untouched, byte for byte', () => {
  for (const [path, text] of openSite.files) {
    if (path.startsWith(`${PIER_PATH}/`) || path === 'feeds.json') continue;
    assert.equal(blockedSite.files.get(path), text, path);
  }
});

test('blocked: the manifest reports zero sets but keeps every feed path for the smoke test', () => {
  const m = blockedSite.site.editions.find((e) => e.festival.basePath === '/fan/pier-nine-2026')!;
  assert.equal(m.blocked, true);
  assert.equal(m.allSetCount, 0);
  assert.equal(m.all.setCount, 0);
  assert.deepEqual(m.stages.map((s) => s.icsPath), ['/fan/pier-nine-2026/pier.ics', '/fan/pier-nine-2026/boathouse.ics']);
  for (const s of m.stages) {
    assert.equal(s.setCount, 0);
    assert.deepEqual(s.headliners, []);
  }
});

test('blocked: the sequence ledger is left exactly as it was, so a revert resumes where it left off', () => {
  const first = buildFixtureSite([harbor, pier]);
  const blocked = buildFixtureSite([harbor, pier], { [PIER_PATH]: { blocked: true } }, '20260201T000000Z', {
    editions: first.nextSequences,
  });
  assert.equal(stableJson(blocked.nextSequences[PIER_PATH]), stableJson(first.nextSequences[PIER_PATH]));
  assert.deepEqual(blocked.editions.find((e) => e.path === PIER_PATH)!.result.changedUids, []);

  // Unblock (the revert): identical feeds to before the block, no SEQUENCE drift.
  const restored = buildFixtureSite([harbor, pier], {}, '20260301T000000Z', { editions: blocked.nextSequences });
  for (const [path, text] of first.files) {
    if (!path.startsWith(`${PIER_PATH}/`)) continue;
    assert.equal(restored.files.get(path), text, `${path} must come back byte-identical after an unblock`);
  }
});

test('blocked: sequences are kept per edition, so a UID shared across namespaces never ping-pongs', () => {
  // Same festival-year, same stage id, same artist in both namespaces → same UID by
  // the frozen derivation. The per-edition ledger keeps their histories apart.
  const ownerTwin = docFromText(pierYamlText().replace('namespace: fan', 'namespace: owner'), 'pier (owner twin)');
  const first = buildFixtureSite([pier, ownerTwin]);
  assert.deepEqual(Object.keys(first.nextSequences).sort(), ['fan/pier-nine-2026', 'pier-nine-2026']);
  const pierUids = Object.keys(first.nextSequences[PIER_PATH]!).sort();
  assert.deepEqual(Object.keys(first.nextSequences['pier-nine-2026']!).sort(), pierUids, 'the UIDs really do collide');

  const second = buildFixtureSite([pier, ownerTwin], {}, '20260201T000000Z', { editions: first.nextSequences });
  for (const e of second.editions) assert.deepEqual(e.result.changedUids, [], `${e.path}: no-op rebuild must not bump`);
});

// ===========================================================================
// The removed page
// ===========================================================================

test('removed page: says the edition was taken down, links the official schedule, carries no stage cards', () => {
  const m = blockedSite.site.editions.find((e) => e.blocked)!;
  const html = renderBlockedPage(m);
  const text = visibleText(html);

  assert.ok(html.includes('<title>Pier Nine 2026 — set times removed</title>'));
  assert.ok(text.includes('Taken down'));
  assert.ok(text.includes('This page was taken down and its calendars are empty now.'));
  assert.ok(text.includes('The official schedule still has the times.'));
  assert.ok(html.includes(`<a class="btn btn--primary" href="${m.festival.officialUrl}">Official schedule</a>`));

  // The CSS is inlined on every page, so look for the elements, not the class names.
  assert.equal(html.includes('class="stage-card"'), false, 'no stage cards');
  assert.equal(html.includes('class="carousel"'), false, 'no carousel');
  assert.equal(html.includes('class="card--all"'), false, 'no all-stages card');
  assert.equal(html.includes('webcal:'), false, 'no Add calendar links');
  assert.equal(html.includes('data-copy'), false, 'no copy-link buttons');
  assert.equal(html.includes('.ics'), false, 'no feed URL anywhere on the page');
  assert.equal(text.includes('Add calendar'), false);
  assert.equal(text.includes('Pier Stage'), false, 'stage names do not appear');
});

test('removed page: keeps the footer promises and the design shell', () => {
  const m = blockedSite.site.editions.find((e) => e.blocked)!;
  const html = renderBlockedPage(m);
  const text = visibleText(html);
  assert.ok(text.includes('Unofficial. Not affiliated with Pier Nine.'), 'unofficial line');
  // visibleText() pads stripped tags with a space, so the link's trailing period detaches.
  assert.ok(text.includes('Source: the official schedule'), 'attribution');
  assert.ok(text.includes('Updated 1 January 2026.'), 'updated stamp from committed state');
  assert.ok(html.includes('aria-label="Stage Times home"'), 'the wordmark in the sticky bar is the way home');
  assert.ok(html.includes('/_vercel/insights/script.js'), 'analytics snippet, like every HTML page');
  assert.ok(html.includes('/assets/fonts/archivo-var-latin.woff2'), 'self-hosted fonts');
});

test('removed page: passes the copy rules — one person, no machinery, no exclamation marks', () => {
  const m = blockedSite.site.editions.find((e) => e.blocked)!;
  const text = visibleText(renderBlockedPage(m));
  assert.doesNotMatch(text, /\b(we|we're|we've|our|ours|us)\b/i, 'corporate first person');
  for (const re of [
    /\biCalendar\b/,
    /\bfeeds?\b/i,
    /\bsubscription\b/i,
    /\bsubscribe\b/i,
    /\bblocked\b/i,
    /\bedition\b/i,
    /\bnamespace\b/i,
    /\btakedown\b/i,
    /rights holder/i,
    /\bunfortunately\b/i,
    /\bplease\b/i,
  ]) {
    assert.doesNotMatch(text, re, `machinery or hedging vocabulary: ${re}`);
  }
  assert.equal(text.includes('!'), false);
});

const movedSite = buildFixtureSite([harbor, pier], { [PIER_PATH]: { blocked: true, movedTo: HARBOR_PATH } });

test('moved: a blocked edition that moved points its page at the new one, one pill, and its calendars are still empty', () => {
  const m = movedSite.site.editions.find((e) => e.blocked)!;
  assert.deepEqual(m.movedTo, { name: harbor.festival.name, year: 2026, basePath: `/${HARBOR_PATH}` });
  assert.equal(m.allSetCount, 0, 'moving does not refill the calendars');
  assert.equal(movedSite.nextPublished.editions[PIER_PATH]!.movedTo, HARBOR_PATH, 'the build carries the pointer forward');

  const html = renderBlockedPage(m);
  const text = visibleText(html);
  assert.ok(html.includes('<title>Pier Nine 2026 — set times moved</title>'));
  assert.ok(text.includes('Moved'));
  assert.ok(text.includes('These set times moved to a new page.'));
  assert.ok(text.includes('add it again from the new page.'));
  assert.ok(html.includes(`<a class="btn btn--primary" href="/${HARBOR_PATH}/">Set times</a>`));
  assert.equal(text.includes('Taken down'), false);
  assert.equal(html.includes('.ics'), false, 'no feed URL anywhere on the page');
  assert.doesNotMatch(text, /\b(we|our|us)\b/i);
  assert.doesNotMatch(text, /\b(feeds?|edition|blocked)\b/i);
});

test('moved: only a blocked edition moves, and only to another edition the build publishes unblocked', () => {
  assert.throws(() => buildFixtureSite([harbor, pier], { [PIER_PATH]: { movedTo: HARBOR_PATH } }), /not blocked/);
  assert.throws(() => buildFixtureSite([harbor, pier], { [PIER_PATH]: { blocked: true, movedTo: 'nowhere-2026' } }), /not another edition/);
  assert.throws(() => buildFixtureSite([harbor, pier], { [PIER_PATH]: { blocked: true, movedTo: PIER_PATH } }), /not another edition/);
  assert.throws(
    () => buildFixtureSite([harbor, pier], { [PIER_PATH]: { blocked: true, movedTo: HARBOR_PATH }, [HARBOR_PATH]: { blocked: true } }),
    /not another edition/,
  );
});

// ===========================================================================
// The whole site on disk: run() twice, byte-identical, both namespaces, blocked page
// ===========================================================================

/** A throwaway repo root with the two fixtures under data/ and a state/ directory. */
function scratchRepo(published: PublishedFile): string {
  const root = mkdtempSync(join(tmpdir(), 'stage-times-editions-'));
  mkdirSync(join(root, 'data', 'fan'), { recursive: true });
  mkdirSync(join(root, 'state'), { recursive: true });
  cpSync(HARBOR_FIXTURE_PATH, join(root, 'data', 'harbor-lights-2026.yaml'));
  cpSync(PIER_FIXTURE_PATH, join(root, 'data', 'fan', 'pier-nine-2026.yaml'));
  writeFileSync(join(root, 'state', 'published.json'), stableJson(published), 'utf8');
  // The build copies the repo's own assets: the fonts, and harbor's festival art so a
  // listed harbor can take its place on the shelf. Pier has none.
  cpSync(join(REPO_ROOT, 'assets', 'fonts'), join(root, 'assets', 'fonts'), { recursive: true });
  mkdirSync(join(root, 'assets', 'festivals'), { recursive: true });
  writeFileSync(join(root, 'assets', 'festivals', 'harbor-lights-2026.webp'), 'harbor art');
  return root;
}

function snapshot(dir: string, prefix = ''): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) for (const [k, v] of snapshot(join(dir, entry.name), rel)) out.set(k, v);
    else out.set(rel, readFileSync(join(dir, entry.name)));
  }
  return out;
}

test('run(): builds every edition under data/ into dist/, both namespaces, and is byte-identical twice', async () => {
  const root = scratchRepo({ publishedAt: '20260808T000000Z', editions: {} });
  try {
    const log = () => {};
    await run({ repoRoot: root, log });
    const first = snapshot(join(root, 'dist'));
    await run({ repoRoot: root, log });
    const second = snapshot(join(root, 'dist'));

    assert.deepEqual([...second.keys()].sort(), [...first.keys()].sort());
    for (const [rel, bytes] of first) assert.ok(bytes.equals(second.get(rel)!), `${rel} differs between two runs`);

    for (const rel of [
      'index.html',
      'feeds.json',
      'harbor-lights-2026/index.html',
      'harbor-lights-2026/main.ics',
      'harbor-lights-2026/all.ics',
      'fan/pier-nine-2026/index.html',
      'fan/pier-nine-2026/pier.ics',
      'fan/pier-nine-2026/boathouse.ics',
      'fan/pier-nine-2026/all.ics',
      'assets/fonts/archivo-var-latin.woff2',
    ]) {
      assert.ok(first.has(rel), `dist/${rel} must exist`);
    }
    assert.equal(existsSync(join(root, 'dist', 'pier-nine-2026')), false, 'the fan edition must not also land at the root');

    // State written back: both editions recorded, unlisted and unblocked, sorted by path.
    const published = readPublished(join(root, 'state', 'published.json'));
    assert.deepEqual(Object.keys(published.editions), ['fan/pier-nine-2026', 'harbor-lights-2026']);
    assert.deepEqual(published.editions['fan/pier-nine-2026'], recordFor(pier));
    const sequences = readSequences(join(root, 'state', 'sequences.json'));
    assert.deepEqual(Object.keys(sequences.editions), ['fan/pier-nine-2026', 'harbor-lights-2026']);
    assert.equal(Object.keys(sequences.editions['fan/pier-nine-2026']!).length, pier.sets.length);

    // The manifest on disk is the site manifest.
    const site = JSON.parse(first.get('feeds.json')!.toString('utf8')) as SiteManifest;
    assert.deepEqual(
      site.editions.map((e) => [e.festival.basePath, e.namespace, e.listed, e.blocked]),
      [
        ['/fan/pier-nine-2026', 'fan', false, false],
        ['/harbor-lights-2026', 'owner', false, false],
      ],
    );
    // Nothing is listed, so the landing page shows no card — never an unlisted edition.
    const landing = first.get('index.html')!.toString('utf8');
    assert.equal(landing.includes('class="shelf-card"'), false, 'no card for an unlisted edition');
    assert.equal(landing.includes('pier-nine-2026'), false, 'the unlisted fan edition is nowhere on the landing page');
    assert.equal(landing.includes('harbor-lights-2026'), false, 'the unlisted owner edition is nowhere on the landing page');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('run(): a blocked edition serves the removed page at its path and the landing page skips it', async () => {
  const root = scratchRepo(
    publishedFor(
      [harbor, pier],
      { [HARBOR_PATH]: { listed: true }, [PIER_PATH]: { listed: true, blocked: true } },
      '20260808T000000Z',
    ),
  );
  try {
    await run({ repoRoot: root, log: () => {} });
    const page = readFileSync(join(root, 'dist', 'fan', 'pier-nine-2026', 'index.html'), 'utf8');
    assert.ok(page.includes('Taken down'));
    assert.equal(page.includes('webcal:'), false);
    const feed = readFileSync(join(root, 'dist', 'fan', 'pier-nine-2026', 'pier.ics'), 'utf8');
    assert.equal(feed.includes('BEGIN:VEVENT'), false);
    assert.ok(feed.includes('X-WR-CALNAME:Pier Stage — Pier Nine 26'));
    const landing = readFileSync(join(root, 'dist', 'index.html'), 'utf8');
    assert.ok(landing.includes('<a class="shelf-card" href="/harbor-lights-2026/"'), 'the listed edition gets its card');
    assert.equal(landing.includes('pier-nine-2026'), false, 'the landing page never lists a blocked edition');
    assert.equal((landing.match(/class="shelf-card"/g) ?? []).length, 1, 'one card, for the one listed edition');
    // The block is recorded verbatim; the listing survives for the revert.
    const published = readPublished(join(root, 'state', 'published.json'));
    assert.equal(published.editions[PIER_PATH]!.blocked, true);
    assert.equal(published.editions[PIER_PATH]!.listed, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('run(): a listed edition with no festival art stays off the homepage, and the build log names the file', async () => {
  const root = scratchRepo(
    publishedFor([harbor, pier], { [HARBOR_PATH]: { listed: true }, [PIER_PATH]: { listed: true } }, '20260808T000000Z'),
  );
  try {
    const lines: string[] = [];
    await run({ repoRoot: root, log: (line) => lines.push(line) });
    const landing = readFileSync(join(root, 'dist', 'index.html'), 'utf8');
    assert.equal((landing.match(/class="shelf-card"/g) ?? []).length, 1, 'harbor has its art; pier waits');
    assert.ok(landing.includes('<img src="/assets/festivals/harbor-lights-2026.webp"'), 'the card shows the committed art');
    assert.equal(landing.includes('pier-nine-2026'), false, 'pier is off the homepage');
    assert.ok(existsSync(join(root, 'dist', 'fan', 'pier-nine-2026', 'index.html')), 'its page still publishes');
    assert.ok(existsSync(join(root, 'dist', 'assets', 'festivals', 'harbor-lights-2026.webp')), 'the art is served');
    assert.ok(
      lines.some((l) => l.includes('fan/pier-nine-2026 is listed but off the homepage') && l.includes('assets/festivals/pier-nine-2026.webp')),
      `the log names the missing file:\n${lines.join('\n')}`,
    );
    assert.equal(lines.some((l) => l.includes('harbor-lights-2026 is listed but off')), false, 'nothing said about the edition with art');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('run(): a published slug that disappeared from the fan edition refuses the whole build', async () => {
  const root = scratchRepo(publishedFor([harbor, pier], { [PIER_PATH]: { stages: ['pier', 'boathouse', 'old-dock'] } }));
  try {
    await assert.rejects(run({ repoRoot: root, log: () => {} }), /old-dock/);
    assert.equal(existsSync(join(root, 'dist')), false, 'nothing is written when gate 4 refuses');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('renderSitePages: writes one page per edition at its namespaced path', () => {
  const out = mkdtempSync(join(tmpdir(), 'stage-times-pages-'));
  try {
    const written = renderSitePages(blockedSite.site, out);
    assert.ok(written.includes('harbor-lights-2026/index.html'));
    assert.ok(written.includes('fan/pier-nine-2026/index.html'));
    assert.ok(written.includes('index.html'));
    assert.ok(readFileSync(join(out, 'fan', 'pier-nine-2026', 'index.html'), 'utf8').includes('Taken down'));
    assert.ok(readFileSync(join(out, 'harbor-lights-2026', 'index.html'), 'utf8').includes('Add calendar'));
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

// ===========================================================================
// Legacy state shapes are refused, not silently misread
// ===========================================================================

test('state: the pre-namespace published.json shape (festivals/default) is refused with a pointer', () => {
  const dir = mkdtempSync(join(tmpdir(), 'stage-times-state-'));
  try {
    const path = join(dir, 'published.json');
    writeFileSync(path, stableJson({ publishedAt: GOLDEN_PUBLISHED_AT, default: 'x-2026', festivals: {} }), 'utf8');
    assert.throws(() => readPublished(path), /expected an `editions` map/);
    writeFileSync(
      path,
      stableJson({ publishedAt: GOLDEN_PUBLISHED_AT, editions: { 'pier-nine-2026': recordFor(pier) } }),
      'utf8',
    );
    assert.throws(() => readPublished(path), /should be keyed "fan\/pier-nine-2026"/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('state: the flat sequences.json ledger is refused with a migration pointer', () => {
  const dir = mkdtempSync(join(tmpdir(), 'stage-times-state-'));
  try {
    const path = join(dir, 'sequences.json');
    writeFileSync(path, stableJson({ events: {} }), 'utf8');
    assert.throws(() => readSequences(path), /kept per edition under `editions`/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
