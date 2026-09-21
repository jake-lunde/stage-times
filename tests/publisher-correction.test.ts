/**
 * The update link through the publisher seam (ticket 09): correction and
 * self-removal, with fake ports.
 *
 * Four paths, one per acceptance box:
 *
 *   correction      the right secret replaces the sets in place; the build then
 *                   advances SEQUENCE for exactly the changed events, and every
 *                   UID is the one subscribers already hold
 *   wrong secret    a wrong or absent secret is a fresh upload: a suffixed
 *                   edition, and the original untouched
 *   notification    a listed edition's correction tells the owner, set by set;
 *                   an unlisted one's tells nobody
 *   self-removal    the edition is blocked, the stored image kept, and the next
 *                   build serves empty calendars and the removed page
 *
 * As in tests/publisher.test.ts, what is asserted is what crossed the seam —
 * the commit, the notification, the result — and what the real build does with
 * the committed files.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  confirm,
  diffSets,
  publish,
  remove,
  sha256,
  upload,
  type ConfirmIntent,
  type ConfirmResult,
  type UpdateClaim,
  type UploadIntent,
} from '../src/publisher.js';
import { buildSite, type PublishedFile, type SequencesFile } from '../src/build.js';
import { renderBlockedPage } from '../src/pages.js';
import { loadFestivalFromString } from '../src/schema.js';
import { fakeClock, fakePorts, fakeVision, FIXED_NOW, image, recordedReply, type Fakes } from './publisher-fakes.js';

const UPLOADER = 'sam@example.com';
const PATH = 'fan/low-tide-2026';
const YAML = 'data/fan/low-tide-2026.yaml';

/** The same Friday, re-read after the festival pushed MUNA back ten minutes and printed an end. */
function correctedReply(mutate: (day: ReplyDay) => void = munaMoved): string {
  const reply = JSON.parse(recordedReply()) as { days: ReplyDay[] };
  mutate(reply.days[0]!);
  return JSON.stringify(reply);
}

interface ReplyDay {
  stages: { name: string; sets: { artist: string; time: string; afters: boolean; annotations: string[] }[] }[];
}

function munaMoved(day: ReplyDay): void {
  const muna = day.stages[0]!.sets.find((s) => s.artist === 'MUNA')!;
  muna.time = '10:50-11:55PM';
}

const original = () => image();
const corrected = () => image({ filename: 'corrected.webp', bytes: new TextEncoder().encode('the friday schedule, fixed') });

function ports(fix = correctedReply()): Fakes {
  return fakePorts({
    vision: fakeVision({ replies: { 'schedule.webp': recordedReply(), 'corrected.webp': fix } }),
    clock: fakeClock(FIXED_NOW),
  });
}

function uploadIntent(overrides: Partial<UploadIntent> = {}): UploadIntent {
  return {
    kind: 'upload',
    festival: 'Low Tide',
    dates: { first: '2026-10-09', last: '2026-10-09' },
    email: UPLOADER,
    image: original(),
    ...overrides,
  };
}

function confirmIntent(overrides: Partial<ConfirmIntent> = {}): ConfirmIntent {
  return {
    kind: 'confirm',
    image: original(),
    festival: 'Low Tide',
    email: UPLOADER,
    timezone: 'America/Los_Angeles',
    timezoneAssumed: true,
    edits: [],
    unverifiable: [],
    ...overrides,
  };
}

/** Publish the original edition and hand back its update link. */
async function published(p: Fakes): Promise<UpdateClaim> {
  const up = await upload(uploadIntent(), p);
  assert.ok(up.ok, `upload was rejected: ${up.rejection?.reason}`);
  const done = await confirm(confirmIntent(), p);
  assert.ok(done.ok, `confirm was rejected: ${done.rejection?.reason}`);
  assert.equal(done.editionPath, PATH);
  return { editionPath: PATH, secret: done.updateSecret! };
}

/** Upload and confirm the corrected image through an update link, an hour later. */
async function correctWith(p: Fakes, update: UpdateClaim | undefined, email = UPLOADER): Promise<ConfirmResult> {
  p.clock.set(FIXED_NOW + 60 * 60 * 1000);
  const up = await upload(uploadIntent({ image: corrected(), email, ...(update ? { update } : {}) }), p);
  assert.ok(up.ok, `correction upload was rejected: ${up.rejection?.reason}`);
  return confirm(confirmIntent({ image: corrected(), email, ...(update ? { update } : {}) }), p);
}

/** Build the committed edition the way the deploy does, from committed state. */
function build(p: Fakes, sequences: SequencesFile = { editions: {} }, path = PATH) {
  const doc = loadFestivalFromString(p.repo.file(`data/${path}.yaml`)!, `data/${path}.yaml`);
  const state = JSON.parse(p.repo.file('state/published.json')!) as PublishedFile;
  const site = buildSite([doc], state, sequences, state.publishedAt);
  return { site, edition: site.editions[0]!, state };
}

// ---------------------------------------------------------------------------
// Box 1 — the right secret replaces the sets; only changed events advance
// ---------------------------------------------------------------------------

test('correction: the right secret replaces the sets and only the changed event advances its SEQUENCE', async () => {
  const p = ports();
  const link = await published(p);
  const first = build(p);
  const ledger: SequencesFile = { editions: { [PATH]: first.edition.result.nextSequences } };
  const uidsBefore = Object.keys(first.edition.result.nextSequences).sort();

  const result = await correctWith(p, link);
  assert.ok(result.ok, result.rejection?.reason);
  assert.equal(result.corrected, true);
  assert.equal(result.editionPath, PATH, 'the same edition, not a new one');
  assert.equal(result.updateSecret, link.secret, 'the link the uploader holds keeps working');

  const doc = loadFestivalFromString(p.repo.file(YAML)!, YAML);
  const muna = doc.sets.find((s) => s.artist === 'MUNA')!;
  assert.equal(muna.start.raw, '2026-10-09T22:50:00', 'the new times replaced the old');
  assert.equal(muna.end.raw, '2026-10-09T23:55:00');

  const second = build(p, ledger);
  const next = second.edition.result.nextSequences;
  assert.deepEqual(Object.keys(next).sort(), uidsBefore, 'every UID is stable');
  assert.deepEqual(second.edition.result.newUids, [], 'no set came back as a new event');
  assert.equal(second.edition.result.changedUids.length, 1, 'exactly one event changed');
  const [changed] = second.edition.result.changedUids;
  for (const [uid, entry] of Object.entries(next)) {
    const was = first.edition.result.nextSequences[uid]!;
    if (uid === changed) {
      assert.equal(entry.sequence, was.sequence + 1, 'the moved set advances');
      assert.equal(entry.lastModified, second.state.publishedAt, 'stamped with the correction');
    } else {
      assert.deepEqual(entry, was, `${uid} is untouched`);
    }
  }
  assert.match(second.site.files.get(`${PATH}/main.ics`)!, /DTSTART;TZID=America\/Los_Angeles:20261009T225000/);
});

test('correction: the edition keeps its slug, flags and uploader, and records the correction', async () => {
  const p = ports();
  const link = await published(p);
  const before = JSON.parse(p.repo.file('state/published.json')!) as PublishedFile;
  await correctWith(p, link);

  const after = JSON.parse(p.repo.file('state/published.json')!) as PublishedFile;
  assert.deepEqual(Object.keys(after.editions), [PATH], 'no second edition');
  const was = before.editions[PATH]!;
  const now = after.editions[PATH]!;
  assert.equal(now.slug, was.slug);
  assert.equal(now.listed, was.listed);
  assert.equal(now.blocked, false);
  assert.equal(now.uploader!.secretHash, was.uploader!.secretHash, 'the same link');
  assert.equal(now.uploader!.verifiedAt, was.uploader!.verifiedAt, 'first confirm stays on record');
  assert.equal(now.uploader!.image, sha256(corrected().bytes), 'the image it is read from now');
  assert.equal(now.uploader!.correctedAt, '20261009T193000Z', 'the injected clock');
  assert.equal(after.publishedAt, '20261009T193000Z', 'the stamp moves, so LAST-MODIFIED says when');

  const commit = p.repo.commits.at(-1)!;
  assert.deepEqual(commit.files.map((f) => f.path), [YAML, 'source/fan/low-tide-2026/TRANSCRIPTION.md', 'state/published.json']);
  assert.deepEqual(commit.images.map((i) => i.path), [`source/images/${sha256(corrected().bytes)}.webp`]);
  assert.equal(p.repo.paths().some((path) => path.startsWith('state/sequences')), false, 'the ledger is the build\'s to write');
});

test('correction: a stage people already added cannot be dropped, and nothing is committed', async () => {
  const p = ports(correctedReply((day) => day.stages.splice(1, 1)));
  const link = await published(p);
  const commits = p.repo.commits.length;
  const result = await correctWith(p, link);
  assert.equal(result.ok, false);
  assert.equal(result.rejection!.gate, 'stages');
  assert.equal(
    result.rejection!.reason,
    "Cellar Stage isn't in these times, and people have already added it. Include the image with its sets.",
  );
  assert.equal(p.repo.commits.length, commits + 1, 'only the paid-for reading of the new image');
});

test('correction: an image that reads as another year is refused before anything is published', async () => {
  const fix = JSON.parse(recordedReply()) as { days: { date: string; header: string }[] };
  fix.days[0]!.date = '2027-10-08';
  fix.days[0]!.header = 'FRIDAY OCTOBER 8, 2027';
  const p = ports(JSON.stringify(fix));
  const link = await published(p);
  p.clock.set(FIXED_NOW + 60 * 60 * 1000);
  const up = await upload(uploadIntent({ image: corrected(), update: link }), p);
  assert.equal(up.ok, false);
  assert.equal(up.rejection!.gate, 'year');
  assert.equal(up.rejection!.reason, 'That image reads as 2027, and this page is for 2026. For 2027, add it as a new festival.');
});

test('correction: the review says it is changing the edition the link names', async () => {
  const p = ports();
  const link = await published(p);
  const up = await upload(uploadIntent({ image: corrected(), update: link }), p);
  assert.ok(up.ok, up.rejection?.reason);
  assert.equal(up.review!.correcting, true);
  assert.equal(up.review!.editionPath, PATH, 'not a suffixed slug');
});

// ---------------------------------------------------------------------------
// Box 2 — a wrong or absent secret is a fresh upload
// ---------------------------------------------------------------------------

for (const [label, update] of [
  ['a wrong secret', { editionPath: PATH, secret: 'not-the-secret' }],
  ['no secret', undefined],
  ['another edition’s path', { editionPath: 'fan/somewhere-else-2026', secret: 'x' }],
] as const) {
  test(`wrong secret: ${label} makes a suffixed edition and leaves the original untouched`, async () => {
    const p = ports();
    const link = await published(p);
    const yamlBefore = p.repo.file(YAML);
    const recordBefore = (JSON.parse(p.repo.file('state/published.json')!) as PublishedFile).editions[PATH];
    void link;

    p.clock.set(FIXED_NOW + 60 * 60 * 1000);
    const up = await upload(uploadIntent({ image: corrected(), email: 'robin@example.com', ...(update ? { update } : {}) }), p);
    assert.ok(up.ok, up.rejection?.reason);
    assert.equal(up.review!.correcting, false);
    assert.equal(up.review!.editionPath, 'fan/low-tide-2-2026', 'the review says where it will really live');

    const result = await confirm(
      confirmIntent({ image: corrected(), email: 'robin@example.com', ...(update ? { update } : {}) }),
      p,
    );
    assert.ok(result.ok, result.rejection?.reason);
    assert.equal(result.corrected, false);
    assert.equal(result.editionPath, 'fan/low-tide-2-2026');
    assert.notEqual(result.updateSecret, update?.secret, 'a new edition, a new link');

    assert.equal(p.repo.file(YAML), yamlBefore, 'the original YAML is byte for byte what it was');
    const last = p.repo.commits.at(-1)!;
    assert.equal(last.files.some((f) => f.path === YAML), false, 'no commit rewrote it');
    const after = JSON.parse(p.repo.file('state/published.json')!) as PublishedFile;
    assert.deepEqual(after.editions[PATH], recordBefore, 'its record too');
    assert.ok(after.editions['fan/low-tide-2-2026'], 'and the upload has an edition of its own');
  });
}

test('wrong secret: a self-removal with the wrong secret is refused and writes nothing', async () => {
  const p = ports();
  await published(p);
  const commits = p.repo.commits.length;
  const result = await remove({ kind: 'remove', update: { editionPath: PATH, secret: 'guess' } }, p);
  assert.equal(result.ok, false);
  assert.equal(result.rejection!.gate, 'update-link');
  assert.equal(result.rejection!.reason, "That update link doesn't match this page. Check you copied all of it.");
  assert.equal(p.repo.commits.length, commits);
  assert.equal(p.repo.published.editions[PATH]!.blocked, false);
});

// ---------------------------------------------------------------------------
// Box 3 — a listed edition's correction tells the owner, set by set
// ---------------------------------------------------------------------------

/** The owner's one-line listing edit, as committed state. */
function list(p: Fakes): void {
  p.repo.published = {
    ...p.repo.published,
    editions: { ...p.repo.published.editions, [PATH]: { ...p.repo.published.editions[PATH]!, listed: true } },
  };
}

test('notification: a correction to a listed edition emits one notification with a per-set diff', async () => {
  const p = ports();
  const link = await published(p);
  list(p);
  const sentBefore = p.notify.sent.length;

  const result = await correctWith(p, link);
  assert.ok(result.ok, result.rejection?.reason);
  assert.equal(result.notifications.length, 1);
  assert.deepEqual(p.notify.sent.slice(sentBefore), result.notifications, 'sent, not just returned');

  const [n] = result.notifications;
  assert.equal(n!.kind, 'edition-corrected');
  assert.equal(n!.editionPath, PATH);
  assert.equal(n!.title, 'Listed edition corrected: Low Tide 2026');
  assert.equal(n!.email, UPLOADER);
  assert.match(n!.body, /^The uploader corrected 1 set through the update link\. Live already; nothing waits on you\./);
  assert.ok(n!.body.includes('- MUNA (Main Stage): Oct 9 22:40–23:40 → Oct 9 22:50–23:55'), n!.body);
  assert.ok(n!.body.includes('https://stagetimes.app/fan/low-tide-2026/'));

  assert.deepEqual(result.changes, [
    {
      kind: 'changed',
      stage: 'main',
      stageName: 'Main Stage',
      before: { artist: 'MUNA', start: '2026-10-09T22:40:00', end: '2026-10-09T23:40:00' },
      after: { artist: 'MUNA', start: '2026-10-09T22:50:00', end: '2026-10-09T23:55:00' },
    },
  ]);
  const state = JSON.parse(p.repo.file('state/published.json')!) as PublishedFile;
  assert.equal(state.editions[PATH]!.listed, true, 'still listed — nothing waits on the owner');
});

test('notification: a correction to an unlisted edition emits none', async () => {
  const p = ports();
  const link = await published(p);
  const sentBefore = p.notify.sent.length;
  const result = await correctWith(p, link);
  assert.ok(result.ok, result.rejection?.reason);
  assert.deepEqual(result.notifications, []);
  assert.equal(p.notify.sent.length, sentBefore, 'nothing sent');
  assert.equal(result.changes.length, 1, 'the diff is still worked out');
});

test('notification: the diff names added, dropped and renamed sets by stage', async () => {
  const p = ports(
    correctedReply((day) => {
      const main = day.stages[0]!.sets;
      main.splice(main.findIndex((s) => s.artist === 'MAGDALENA BAY'), 1);
      main.splice(1, 0, { artist: 'WET LEG', time: '7:00-7:45PM', afters: false, annotations: [] }); // printed order
      day.stages[1]!.sets.find((s) => s.artist === 'DARK CHISME')!.time = '10:30-11:15PM';
    }),
  );
  const link = await published(p);
  list(p);
  const result = await correctWith(p, link);
  assert.ok(result.ok, result.rejection?.reason);
  const body = result.notifications[0]!.body;
  assert.ok(body.includes('- Added: WET LEG (Main Stage), Oct 9 19:00–19:45'), body);
  assert.ok(body.includes('- Dropped: MAGDALENA BAY (Main Stage), was Oct 9 21:00–22:00'), body);
  assert.ok(body.includes('- DARK CHISME (Cellar Stage): Oct 9 22:45–23:30 → Oct 9 22:30–23:15'), body);
  assert.deepEqual(result.changes.map((c) => c.kind).sort(), ['added', 'changed', 'removed']);
});

test('notification: diffSets agrees with the build about what changed', () => {
  const yaml = (time: string) =>
    [
      'namespace: fan',
      'verified: true',
      'festival: { name: Low Tide, slug: low-tide, year: 2026, timezone: America/Los_Angeles, official_url: "https://lowtide.example" }',
      'stages: [{ id: main, name: Main Stage }]',
      'sets:',
      `  - { stage: main, artist: MUNA, start: "2026-10-09T${time}:00", end: "2026-10-09T23:55:00", end_inferred: false }`,
      '  - { stage: main, artist: AVERY COCHRANE, start: "2026-10-09T15:15:00", end: "2026-10-09T15:45:00", end_inferred: false }',
    ].join('\n');
  const before = loadFestivalFromString(yaml('22:40'), 'before');
  assert.deepEqual(diffSets(before, before), [], 'the same schedule changes nothing');
  const after = loadFestivalFromString(yaml('22:50'), 'after');
  assert.deepEqual(diffSets(before, after).map((c) => c.after!.artist), ['MUNA']);
});

// ---------------------------------------------------------------------------
// Box 4 — self-removal blocks the edition and keeps the image
// ---------------------------------------------------------------------------

test('self-removal: the edition is blocked, the stored image kept, and the next build serves empty calendars and the removed page', async () => {
  const p = ports();
  const link = await published(p);
  list(p);
  const storedImages = p.repo.commits.flatMap((c) => c.images.map((i) => i.path));
  assert.deepEqual(storedImages, [`source/images/${sha256(original().bytes)}.webp`]);
  const yamlBefore = p.repo.file(YAML);

  const result = await remove({ kind: 'remove', update: link }, p);
  assert.ok(result.ok, result.rejection?.reason);
  assert.equal(result.editionPath, PATH);

  const commit = result.commit!;
  assert.deepEqual(commit.files.map((f) => f.path), ['state/published.json'], 'the one-line edit and nothing else');
  assert.deepEqual(commit.images, [], 'no image written');
  assert.match(commit.message, /self-removal/);
  assert.match(commit.message, /image is kept/);
  assert.equal(p.repo.file(YAML), yamlBefore, 'the YAML stays so every stage keeps its name');

  const state = JSON.parse(p.repo.file('state/published.json')!) as PublishedFile;
  assert.equal(state.editions[PATH]!.blocked, true);
  assert.equal(state.editions[PATH]!.listed, true, 'listing left alone, so a revert restores it');
  assert.ok(state.editions[PATH]!.uploader, 'the uploader record stays');

  const { edition, site } = build(p);
  const m = edition.result.manifest;
  assert.equal(m.blocked, true);
  assert.equal(m.listed, false, 'a blocked edition is never listed');
  for (const stage of ['main', 'cellar', 'all']) {
    const ics = site.files.get(`${PATH}/${stage}.ics`)!;
    assert.ok(ics.startsWith('BEGIN:VCALENDAR'), `${stage}.ics still answers`);
    assert.equal(ics.includes('BEGIN:VEVENT'), false, `${stage}.ics is empty`);
  }
  const page = renderBlockedPage(m);
  assert.ok(page.includes('<h3>Taken down</h3>'), 'the removed page');
  assert.equal(page.includes('.ics'), false, 'no calendar link on it');
});

test('self-removal: a second removal writes nothing, and the link no longer corrects', async () => {
  const p = ports();
  const link = await published(p);
  await remove({ kind: 'remove', update: link }, p);
  const commits = p.repo.commits.length;

  const again = await remove({ kind: 'remove', update: link }, p);
  assert.ok(again.ok);
  assert.equal(again.commit, null);

  const vision = p.vision.checks + p.vision.transcriptions;
  const up = await upload(uploadIntent({ image: corrected(), update: link }), p);
  assert.equal(up.ok, false);
  assert.equal(up.rejection!.gate, 'removed');
  assert.equal(up.rejection!.reason, "This page was taken down, so it can't be changed from here.");
  assert.equal(p.vision.checks + p.vision.transcriptions, vision, 'refused before anything is spent');

  const done = await confirm(confirmIntent({ update: link }), p);
  assert.equal(done.rejection!.gate, 'removed');
  assert.equal(p.repo.commits.length, commits);
});

test('seam: publish() dispatches a remove intent', async () => {
  const p = ports();
  const link = await published(p);
  const result = await publish({ kind: 'remove', update: link }, p);
  assert.ok(result.ok);
  assert.equal(result.editionPath, PATH);
});
