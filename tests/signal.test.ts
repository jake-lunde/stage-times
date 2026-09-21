/**
 * The signal: the intent that notices set times appearing where the watcher
 * cannot read them — a post on the festival's subreddit — and sends the owner
 * a link (CONTEXT: signal). Fake ports throughout, as in
 * tests/watcher.test.ts, plus a Reddit port that replays recorded subreddit
 * listings. What each test asserts on is what crossed the seam: the listing
 * requests, the notifications, the commit.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { signal, SIGNAL_MIN_VOTES, SIGNAL_STATE_PATH, type SignalIntent } from '../src/signal.js';
import { loadWatchList, type WatchEntry } from '../src/watcher.js';
import { fakeNotifier, fakeReddit, fakeSignalPorts, recordedListing, type SignalFakes } from './publisher-fakes.js';

function entry(overrides: Partial<WatchEntry> = {}): WatchEntry {
  return {
    festival: 'Low Tide',
    slug: 'low-tide',
    year: 2026,
    source: 'https://lowtide.example/schedule',
    timezone: 'America/Los_Angeles',
    dates: { first: '2026-10-09', last: '2026-10-11' },
    window: { from: '2026-09-25', to: '2026-10-11' },
    subreddit: 'LowTideFest',
    ...overrides,
  };
}

const intent = (list: WatchEntry[], extra: Partial<SignalIntent> = {}): SignalIntent => ({ kind: 'signal', list, ...extra });

/** The one post in the recorded listing that is about set times, this year, inside the window, above the threshold. */
const MATCH = 'https://www.reddit.com/r/LowTideFest/comments/lt0002/friday_set_times_are_out/';

function ports(listing: string | null = recordedListing()): SignalFakes {
  return fakeSignalPorts({ reddit: fakeReddit({ LowTideFest: listing }) });
}

/** The recorded listing with one post's score changed, as a later poll would see it. */
function withScore(id: string, score: number): string {
  const listing = JSON.parse(recordedListing()) as { data: { children: { data: { id: string; score: number; ups: number } }[] } };
  for (const child of listing.data.children) if (child.data.id === id) Object.assign(child.data, { score, ups: score });
  return JSON.stringify(listing);
}

// ---------------------------------------------------------------------------
// The subreddit on a watch entry
// ---------------------------------------------------------------------------

const BASE = { festival: 'Low Tide', year: 2026, source: 'https://lowtide.example/schedule', timezone: 'America/Los_Angeles', dates: { first: '2026-10-09', last: '2026-10-11' }, window: { from: '2026-09-25' } };

test('signal: a watch entry may name a subreddit, with or without r/, and a name Reddit would not allow is refused', () => {
  const [plain, prefixed, none] = loadWatchList(JSON.stringify([
    { ...BASE, subreddit: 'LowTideFest' },
    { ...BASE, slug: 'low-tide-b', subreddit: '/r/LowTideFest' },
    { ...BASE, slug: 'low-tide-c' },
  ]));
  assert.equal(plain!.subreddit, 'LowTideFest');
  assert.equal(prefixed!.subreddit, 'LowTideFest', 'the r/ prefix is dropped');
  assert.equal('subreddit' in none!, false, 'no subreddit, no field');
  for (const bad of ['low tide', 'r/', 'x', 'a'.repeat(22), 'low-tide']) {
    assert.throws(() => loadWatchList(JSON.stringify([{ ...BASE, subreddit: bad }])), /subreddit/, `${bad} is refused`);
  }
});

test('signal: entries without a subreddit are skipped by the signal — nothing is fetched for them', async () => {
  const p = ports();
  const result = await signal(intent([entry({ subreddit: undefined, slug: 'no-sub' }), entry()]), p);
  assert.deepEqual(p.reddit.fetches, ['LowTideFest'], 'only the entry that names one is polled');
  assert.equal(result.reports[0]!.outcome, 'no-subreddit');
  assert.equal(result.reports[1]!.outcome, 'signal');
});

// ---------------------------------------------------------------------------
// Firing
// ---------------------------------------------------------------------------

test('signal: against a recorded subreddit listing, fires once for the matching post above the vote threshold', async () => {
  const p = ports();
  const result = await signal(intent([entry()]), p);
  // The listing also holds: a matching post under the threshold, a busy post
  // not about set times, last year's set times, a post from before the drop
  // window, and the sticky discussion thread. None of them fire.
  assert.equal(p.notify.sent.length, 1, 'one notification');
  assert.equal(p.notify.sent[0]!.body, MATCH);
  assert.deepEqual(result.reports[0]!.posts, [MATCH]);
});

test('signal: never fires again for the same post', async () => {
  const p = ports();
  await signal(intent([entry()]), p);
  assert.equal(p.repo.commits.length, 1, 'the post it fired for is recorded');

  const again = await signal(intent([entry()]), p);
  assert.equal(p.notify.sent.length, 1, 'no second notification');
  assert.equal(again.reports[0]!.outcome, 'nothing');
  assert.equal(again.commit, null, 'and nothing to record');

  p.reddit.listings['LowTideFest'] = withScore('lt0002', 900);
  await signal(intent([entry()]), p);
  assert.equal(p.notify.sent.length, 1, 'not even once it has gained more votes');
});

test('signal: a post about set times fires on the poll where its votes cross the threshold', async () => {
  const p = ports();
  await signal(intent([entry()]), p);
  assert.equal(p.notify.sent.length, 1);

  p.reddit.listings['LowTideFest'] = withScore('lt0003', SIGNAL_MIN_VOTES);
  const later = await signal(intent([entry()]), p);
  assert.equal(p.notify.sent.length, 2);
  assert.equal(p.notify.sent[1]!.body, 'https://www.reddit.com/r/LowTideFest/comments/lt0003/set_times_clash_thread/');
  assert.equal(later.reports[0]!.outcome, 'signal');
});

test('signal: the notification carries the post link, the festival, and the edition, and nothing else', async () => {
  const p = ports();
  await signal(intent([entry()]), p);
  assert.deepEqual(p.notify.sent[0], {
    kind: 'signal',
    editionPath: 'low-tide-2026',
    title: 'Set times on Reddit: Low Tide 2026',
    body: MATCH,
  });
  const said = JSON.stringify(p.notify.sent[0]);
  assert.doesNotMatch(said, /i\.redd\.it/, 'never the image the post links to');
  assert.doesNotMatch(said, /Friday set times are out/, 'never the post title');
  assert.doesNotMatch(said, /someone_/, 'never the poster');
});

// ---------------------------------------------------------------------------
// When and how much it polls
// ---------------------------------------------------------------------------

test('signal: polls only inside the drop window — not before it, not after the festival — unless forced', async () => {
  const before = entry({ slug: 'early', window: { from: '2026-10-20', to: '2026-10-25' }, dates: { first: '2026-10-24', last: '2026-10-25' } });
  const over = entry({ slug: 'over', dates: { first: '2026-09-01', last: '2026-09-03' }, window: { from: '2026-08-20', to: '2026-09-03' } });
  const p = ports();
  const result = await signal(intent([before, over]), p);
  assert.deepEqual(p.reddit.fetches, [], 'nothing polled');
  assert.deepEqual(result.reports.map((r) => r.outcome), ['not-due', 'dormant']);

  const forced = await signal(intent([before, over], { force: true }), p);
  assert.deepEqual(p.reddit.fetches, ['LowTideFest'], 'force polls the entry whose festival is not over, and only that one');
  assert.deepEqual(forced.reports.map((r) => r.outcome), ['nothing', 'dormant'], 'polled, and a post from before its window still does not count');
});

test('signal: one listing request per subreddit per run, however many entries name it', async () => {
  const p = fakeSignalPorts({ reddit: fakeReddit({ LowTideFest: recordedListing() }) });
  await signal(intent([entry(), entry({ slug: 'low-tide-weekend-two', subreddit: 'lowtidefest' })]), p);
  assert.deepEqual(p.reddit.fetches, ['LowTideFest'], 'one request, names compared as Reddit compares them');
  assert.equal(p.notify.sent.length, 2, 'each edition hears about it once');
  assert.deepEqual(p.notify.sent.map((n) => n.editionPath), ['low-tide-2026', 'low-tide-weekend-two-2026']);
});

test('signal: a subreddit that does not answer with a listing is reported and writes nothing', async () => {
  for (const answer of [null, '<html>blocked by network security</html>', '{"kind":"t2","data":{}}']) {
    const p = ports(answer);
    const result = await signal(intent([entry()]), p);
    assert.equal(result.reports[0]!.outcome, 'unreachable', `answer ${String(answer).slice(0, 20)}`);
    assert.equal(result.commit, null);
    assert.equal(p.notify.sent.length, 0);
  }
});

// ---------------------------------------------------------------------------
// It is a signal: no image, nothing created
// ---------------------------------------------------------------------------

test('signal: never pulls an image and creates nothing — no model call, no pull request, only its own state committed', async () => {
  const p = ports();
  const result = await signal(intent([entry()]), p);
  assert.equal(p.vision.checks + p.vision.transcriptions, 0, 'no model call');
  assert.equal(p.repo.pullRequests.length, 0, 'no pull request');
  assert.deepEqual(p.repo.paths(), [SIGNAL_STATE_PATH], 'the commit holds the signal state and nothing else');
  assert.equal(result.commit!.images.length, 0);
  const state = JSON.parse(p.repo.file(SIGNAL_STATE_PATH)!) as { entries: Record<string, Record<string, { link: string; at: string }>> };
  assert.deepEqual(state.entries['low-tide-2026'], { lt0002: { link: MATCH, at: '20261009T183000Z' } }, 'stamped by the injected clock');
});

test('signal: a notification that will not send is not recorded, so the next run tries again', async () => {
  const p = ports();
  const failing = fakeNotifier();
  failing.send = async () => {
    throw new Error('GitHub issue write answered HTTP 502');
  };
  const first = await signal(intent([entry()]), { ...p, notify: failing });
  assert.match(first.reports[0]!.problem ?? '', /502/);
  assert.equal(first.commit, null, 'nothing recorded');

  await signal(intent([entry()]), p);
  assert.equal(p.notify.sent.length, 1, 'the next run sends it');
});
