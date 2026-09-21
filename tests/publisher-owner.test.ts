/**
 * The owner path: the same upload and confirm, carrying the owner secret from
 * the bookmarked link — and the listing pull request a fan confirm opens on the
 * owner's behalf.
 *
 * Fake ports throughout, as in tests/publisher.test.ts. The owner port is a
 * fake that recognizes one fixed secret; what each test asserts on is what
 * crossed the seam — the commit, the pull request, the notification — never
 * how the check is done inside.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { confirm, upload, type ConfirmIntent, type ConfirmResult, type Review, type UploadIntent } from '../src/publisher.js';
import { buildSite, type PublishedFile } from '../src/build.js';
import { listedEditions } from '../src/pages.js';
import { loadFestivalFromString } from '../src/schema.js';
import {
  fakeOwner,
  fakePorts,
  fakeRepository,
  image,
  OWNER_SECRET,
  type Fakes,
} from './publisher-fakes.js';

const UPLOADER = 'sam@example.com';

function uploadIntent(overrides: Partial<UploadIntent> = {}): UploadIntent {
  return {
    kind: 'upload',
    festival: 'Low Tide',
    dates: { first: '2026-10-09', last: '2026-10-09' },
    email: UPLOADER,
    image: image(),
    ...overrides,
  };
}

function confirmIntent(review: Review, overrides: Partial<ConfirmIntent> = {}): ConfirmIntent {
  return {
    kind: 'confirm',
    image: image(),
    festival: 'Low Tide',
    email: UPLOADER,
    timezone: review.timezone,
    timezoneAssumed: review.timezoneAssumed,
    edits: [],
    unverifiable: [],
    ...overrides,
  };
}

/** Upload then confirm, both carrying `owner` when given. */
async function publishWith(owner: string | undefined, ports: Fakes = fakePorts()): Promise<{ result: ConfirmResult; review: Review; ports: Fakes }> {
  const up = await upload(uploadIntent(owner === undefined ? {} : { owner }), ports);
  assert.ok(up.ok, `upload was rejected: ${up.rejection?.reason}`);
  const review = up.review!;
  const result = await confirm(confirmIntent(review, owner === undefined ? {} : { owner }), ports);
  return { result, review, ports };
}

function publishedOf(ports: Fakes): PublishedFile {
  return JSON.parse(ports.repo.file('state/published.json')!) as PublishedFile;
}

/** The lines of `after` that differ from `before`, position by position. */
function changedLines(before: string, after: string): { before: string; after: string }[] {
  const a = before.split('\n');
  const b = after.split('\n');
  assert.equal(a.length, b.length, 'a listing changes a line, it never adds or removes one');
  return a.flatMap((line, i) => (line === b[i] ? [] : [{ before: line, after: b[i]! }]));
}

// ---------------------------------------------------------------------------
// The owner's confirm
// ---------------------------------------------------------------------------

test('owner: a confirm carrying the owner secret writes the root namespace with listed set, in one commit', async () => {
  const { result, ports } = await publishWith(OWNER_SECRET);
  assert.ok(result.ok, result.rejection?.reason);
  assert.equal(result.editionPath, 'low-tide-2026');

  const publish = ports.repo.commits.at(-1)!;
  const paths = publish.files.map((f) => f.path);
  assert.ok(paths.includes('data/low-tide-2026.yaml'), `the YAML sits at the root of data/: ${paths.join(', ')}`);
  assert.ok(paths.includes('source/low-tide-2026/TRANSCRIPTION.md'), 'the log sits beside the owner edition');
  assert.ok(paths.includes('state/published.json'), 'the listing rides in the same commit as the edition');
  assert.ok(!paths.some((p) => p.startsWith('data/fan/')), 'nothing written under data/fan/');

  const doc = loadFestivalFromString(ports.repo.file('data/low-tide-2026.yaml')!, 'data/low-tide-2026.yaml');
  assert.equal(doc.namespace, 'owner');
  assert.equal(doc.verified, true, 'the owner checking every set is the human check');

  const record = publishedOf(ports).editions['low-tide-2026'];
  assert.ok(record, 'recorded under the root path');
  assert.equal(record.namespace, 'owner');
  assert.equal(record.listed, true, 'the human tapping confirm is the approval');
  assert.equal(record.blocked, false);
  assert.equal(publishedOf(ports).editions['fan/low-tide-2026'], undefined, 'no fan edition was made');
});

test('owner: the same confirm without the owner secret writes the fan namespace, unlisted', async () => {
  const { result, ports } = await publishWith(undefined);
  assert.ok(result.ok, result.rejection?.reason);
  assert.equal(result.editionPath, 'fan/low-tide-2026');

  const paths = ports.repo.paths();
  assert.ok(paths.includes('data/fan/low-tide-2026.yaml'), 'the YAML sits under data/fan/');
  assert.ok(!paths.some((p) => /^data\/[^/]+\.ya?ml$/.test(p)), 'nothing written at the root of data/');

  const record = publishedOf(ports).editions['fan/low-tide-2026']!;
  assert.equal(record.namespace, 'fan');
  assert.equal(record.listed, false, 'a fan confirm never lists');
  assert.equal(publishedOf(ports).editions['low-tide-2026'], undefined, 'the root namespace is untouched');
});

test('owner: an upload carrying the owner secret reviews at the root path', async () => {
  const ports = fakePorts();
  const owned = await upload(uploadIntent({ owner: OWNER_SECRET }), ports);
  assert.ok(owned.ok, owned.rejection?.reason);
  assert.equal(owned.review!.namespace, 'owner');
  assert.equal(owned.review!.editionPath, 'low-tide-2026');

  const fan = await upload(uploadIntent(), ports);
  assert.equal(fan.review!.namespace, 'fan');
  assert.equal(fan.review!.editionPath, 'fan/low-tide-2026');
});

test('owner: the owner confirm opens no pull request and sends no notification — the tap was the approval', async () => {
  const { result, ports } = await publishWith(OWNER_SECRET);
  assert.ok(result.ok, result.rejection?.reason);
  assert.deepEqual(result.pullRequests, []);
  assert.deepEqual(ports.repo.pullRequests, []);
  assert.deepEqual(ports.notify.sent, [], 'nothing machine-initiated happened, so nothing lands in the inbox');
  assert.ok(result.updateSecret, 'the success screen is the same screen, update link and all');
});

test('owner: a root edition already published is refused, never overwritten and never suffixed', async () => {
  const repo = fakeRepository({
    published: {
      publishedAt: '20260101T000000Z',
      editions: {
        'low-tide-2026': { slug: 'low-tide', year: 2026, namespace: 'owner', listed: true, blocked: false, stages: ['main'] },
      },
    },
  });
  const ports = fakePorts({ repo });

  const up = await upload(uploadIntent({ owner: OWNER_SECRET }), ports);
  assert.equal(up.ok, false, 'the review would show a page that already exists');
  assert.equal(up.rejection!.gate, 'details');

  const review = (await upload(uploadIntent(), ports)).review!;
  const commitsBefore = repo.commits.length;
  const result = await confirm(confirmIntent(review, { owner: OWNER_SECRET }), ports);
  assert.equal(result.ok, false);
  assert.equal(result.rejection!.gate, 'details');
  assert.match(result.rejection!.reason, /already has a page/);
  assert.equal(repo.commits.length, commitsBefore, 'nothing committed');
  assert.deepEqual(Object.keys(repo.published.editions), ['low-tide-2026'], 'no low-tide-2-2026 at the root');
});

// ---------------------------------------------------------------------------
// A wrong secret is no secret
// ---------------------------------------------------------------------------

test('owner: a wrong owner secret is treated exactly as no secret, on upload and on confirm', async () => {
  const none = await publishWith(undefined);
  const wrong = await publishWith('not-the-owner-secret');

  assert.ok(wrong.result.ok, wrong.result.rejection?.reason);
  assert.deepEqual(wrong.review, none.review, 'the review does not change');
  assert.deepEqual(wrong.result, none.result, 'the confirm result does not change');
  assert.deepEqual(wrong.ports.repo.commits, none.ports.repo.commits, 'the commits do not change');
  assert.deepEqual(wrong.ports.repo.pullRequests, none.ports.repo.pullRequests);
  assert.deepEqual(wrong.ports.notify.sent, none.ports.notify.sent);
});

test('owner: with no owner secret set on the deployment, a presented one is no secret and nothing errors', async () => {
  const unset = await publishWith(OWNER_SECRET, fakePorts({ owner: fakeOwner(null) }));
  const none = await publishWith(undefined);
  assert.ok(unset.result.ok, unset.result.rejection?.reason);
  assert.deepEqual(unset.result, none.result);
  assert.equal(unset.result.editionPath, 'fan/low-tide-2026');
});

test('owner: an empty owner secret is no secret', async () => {
  const empty = await publishWith('', fakePorts({ owner: fakeOwner('') }));
  assert.equal(empty.result.editionPath, 'fan/low-tide-2026');
});

// ---------------------------------------------------------------------------
// The listing pull request
// ---------------------------------------------------------------------------

test('listing: a fan confirm opens a pull request whose only change is listing that edition', async () => {
  const { result, ports } = await publishWith(undefined);
  assert.ok(result.ok, result.rejection?.reason);

  assert.equal(ports.repo.pullRequests.length, 1);
  const pr = ports.repo.pullRequests[0]!;
  assert.deepEqual(result.pullRequests, [pr]);
  assert.equal(pr.title, 'List Low Tide 2026');
  assert.equal(pr.branch, 'list/fan/low-tide-2026');
  assert.equal(pr.from, 'commit-2', 'branched from the publish commit, so the diff is against what was published');
  assert.equal(ports.repo.commits.length, 2, 'upload and publish on main; the pull request applies nothing yet');

  assert.deepEqual(pr.commit.files.map((f) => f.path), ['state/published.json']);
  assert.deepEqual(pr.commit.images, []);

  const onMain = ports.repo.file('state/published.json')!;
  const proposed = pr.commit.files[0]!.contents;
  assert.deepEqual(changedLines(onMain, proposed), [{ before: '      "listed": false,', after: '      "listed": true,' }]);

  const before = JSON.parse(onMain) as PublishedFile;
  const after = JSON.parse(proposed) as PublishedFile;
  assert.equal(after.editions['fan/low-tide-2026']!.listed, true);
  after.editions['fan/low-tide-2026']!.listed = false;
  assert.deepEqual(after, before, 'publishedAt, the uploader record and every other edition are as published');
});

test('listing: the pull request body carries the subscribe page link and the set count', async () => {
  const { ports } = await publishWith(undefined);
  const pr = ports.repo.pullRequests[0]!;
  assert.match(pr.body, /https:\/\/stagetimes\.app\/fan\/low-tide-2026\//);
  assert.match(pr.body, /\b5 sets across 2 stages\b/);
  assert.doesNotMatch(pr.body, /sam@example\.com/, 'the address stays out of anything public but the notification');
  assert.doesNotMatch(pr.commit.message + pr.title, /sam@example\.com/);
});

test('listing: merging that pull request lists the edition on the next build and nothing else changes', async () => {
  const { ports } = await publishWith(undefined);
  const doc = loadFestivalFromString(ports.repo.file('data/fan/low-tide-2026.yaml')!, 'data/fan/low-tide-2026.yaml');

  const unlisted = publishedOf(ports);
  const before = buildSite([doc], unlisted, { editions: {} }, unlisted.publishedAt);
  assert.deepEqual(listedEditions(before.site), [], 'not on the homepage until merged');

  await ports.repo.merge(ports.repo.pullRequests[0]!);
  const listed = publishedOf(ports);
  const after = buildSite([doc], listed, { editions: {} }, listed.publishedAt);

  assert.deepEqual(listedEditions(after.site).map((e) => e.festival.basePath), ['/fan/low-tide-2026']);
  assert.deepEqual([...after.files.keys()], [...before.files.keys()], 'no file appears or disappears');
  for (const [path, text] of after.files) {
    if (path === 'feeds.json') continue;
    assert.equal(text, before.files.get(path), `${path} changed on a listing`);
  }
  const manifestBefore = JSON.parse(before.files.get('feeds.json')!) as { editions: { listed: boolean }[] };
  const manifestAfter = JSON.parse(after.files.get('feeds.json')!) as { editions: { listed: boolean }[] };
  manifestAfter.editions[0]!.listed = false;
  assert.deepEqual(manifestAfter, manifestBefore, 'the manifest differs by the listed flag alone');
  assert.deepEqual(after.nextSequences, before.nextSequences, 'no SEQUENCE moves');
  assert.equal(after.nextPublished.editions['fan/low-tide-2026']!.listed, true, 'the build keeps the listing');
});

test('listing: a pull request that cannot be opened leaves the publish standing, and the notification says to list by hand', async () => {
  const ports = fakePorts({ repo: fakeRepository({ pullRequestsFail: true }) });
  const { result } = await publishWith(undefined, ports);
  assert.ok(result.ok, 'the edition is live and the update link is the uploader’s only copy — never throw it away');
  assert.ok(result.updateSecret);
  assert.deepEqual(result.pullRequests, []);
  assert.equal(ports.notify.sent.length, 1);
  assert.match(ports.notify.sent[0]!.body, /listing pull request could not be opened/i);
  assert.match(ports.notify.sent[0]!.body, /HTTP 403/);
});

test('listing: the notification points at the listing pull request when it opened', async () => {
  const { ports } = await publishWith(undefined);
  assert.equal(ports.notify.sent.length, 1);
  assert.match(ports.notify.sent[0]!.body, /Merge the listing pull request to list it/);
});
