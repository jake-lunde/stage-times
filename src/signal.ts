/**
 * Stage Times — the signal.
 *
 * A notice that set times appear to have dropped somewhere the watcher cannot
 * read — an app, a social post — sent to the owner with a link (CONTEXT:
 * signal). It is the watcher's sibling through the same seam: an intent — the
 * watch list — plus the publisher's ports and one more, for subreddit
 * listings, go in, and the notifications and the one state commit it would
 * make come out. Nothing in here opens a socket or looks at a clock;
 * `src/watch.ts` is the scheduled entrypoint and `src/ports.ts` the outside
 * world.
 *
 * What one poll of one entry does, inside its drop window only:
 *
 *   1. read the newest posts on the entry's subreddit — one listing request
 *      per subreddit per run, however many entries name it
 *   2. keep the posts about set times (`SET_TIMES_RE`), posted inside the
 *      window, not about another year, with at least `SIGNAL_MIN_VOTES`
 *   3. send the owner the link to each one not sent before, and record it
 *
 * A signal carries no image and creates nothing: no model call, no pull
 * request, no edition. The owner goes and gets the screenshot, and uploads it
 * through the bookmark.
 */

import { committedJson, icalStamp, sortKeys, type Commit, type Notification, type PublisherPorts } from './publisher.js';
import { cadenceOf, keyOf, type Cadence, type WatchEntry, type WatchList } from './watcher.js';

// ---------------------------------------------------------------------------
// What counts
// ---------------------------------------------------------------------------

/** A post title about set times: "set times", "set-times", "stage times", "timetable", "schedule". */
export const SET_TIMES_RE = /\b(set[\s-]?times?|stage[\s-]?times|time[\s-]?tables?|schedules?)\b/i;

/** The votes a post needs before it is worth the owner's attention. Small festival subreddits are small. */
export const SIGNAL_MIN_VOTES = 10;

/** One post, as much of it as the signal reads. */
export interface RedditPost {
  id: string;
  title: string;
  score: number;
  /** Seconds since the epoch, UTC. */
  createdUtc: number;
  /** The post's absolute link on reddit.com — never the image or page it links to. */
  link: string;
}

/**
 * The posts in a subreddit listing (Reddit's `new.json` shape), or null when
 * the text is not a listing — a login wall, a block page, an error body.
 */
export function postsIn(text: string): RedditPost[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const listing = parsed as { kind?: unknown; data?: { children?: unknown } };
  if (listing?.kind !== 'Listing' || !Array.isArray(listing.data?.children)) return null;
  const posts: RedditPost[] = [];
  for (const child of listing.data.children as { kind?: unknown; data?: Record<string, unknown> }[]) {
    const d = child?.data;
    if (child?.kind !== 't3' || !d) continue;
    const { id, title, score, created_utc: created, permalink } = d;
    if (typeof id !== 'string' || typeof title !== 'string' || typeof score !== 'number' || typeof created !== 'number') continue;
    if (typeof permalink !== 'string' || !permalink.startsWith('/r/')) continue;
    posts.push({ id, title, score, createdUtc: created, link: `https://www.reddit.com${permalink}` });
  }
  return posts;
}

/** Is this post the one the owner wants to hear about, for this entry? */
export function isSignal(post: RedditPost, entry: WatchEntry): boolean {
  if (post.score < SIGNAL_MIN_VOTES) return false;
  if (!SET_TIMES_RE.test(post.title)) return false;
  if (post.createdUtc * 1000 < Date.parse(`${entry.window.from}T00:00:00Z`)) return false;
  const years = post.title.match(/\b20\d\d\b/g) ?? [];
  return years.every((y) => Number(y) === entry.year);
}

// ---------------------------------------------------------------------------
// Ports
// ---------------------------------------------------------------------------

/** The outside world the signal reads: a subreddit's newest posts, over Reddit's public JSON. */
export interface RedditPort {
  /** The listing's JSON text, or null when it did not answer with one. */
  listing(subreddit: string): Promise<string | null>;
}

export interface SignalPorts extends PublisherPorts {
  reddit: RedditPort;
}

// ---------------------------------------------------------------------------
// Committed state the signal owns
// ---------------------------------------------------------------------------

export const SIGNAL_STATE_PATH = 'state/signal.json';

/** One post the owner was sent. */
export interface SignalledPost {
  link: string;
  /** When it was sent, as a UTC iCalendar stamp. */
  at: string;
}

export interface SignalState {
  $comment?: string | string[];
  /** Per edition, every post sent, by Reddit's post id. */
  entries: Record<string, Record<string, SignalledPost>>;
}

const SIGNAL_COMMENT = [
  'COMMITTED STATE — every subreddit post the signal has sent the owner (src/signal.ts), per edition,',
  'by post id, so no post is sent twice. Written only when a post was sent. Nothing in the build reads',
  'this file.',
];

// ---------------------------------------------------------------------------
// Intent and result
// ---------------------------------------------------------------------------

export interface SignalIntent {
  kind: 'signal';
  list: WatchList;
  /** Poll every entry that names a subreddit and is not dormant, drop window or not. */
  force?: boolean;
}

export type SignalOutcome =
  /** The festival is over. */
  | 'dormant'
  /** Outside the drop window. */
  | 'not-due'
  /** The entry names no subreddit. */
  | 'no-subreddit'
  /** The subreddit did not answer with a listing. Nothing recorded; the next run tries again. */
  | 'unreachable'
  /** No post worth sending, or none not sent before. */
  | 'nothing'
  /** At least one post was sent. */
  | 'signal';

export interface SignalReport {
  key: string;
  festival: string;
  cadence: Cadence;
  subreddit: string | null;
  outcome: SignalOutcome;
  /** The links sent on this run. */
  posts: string[];
  /** One sentence when a notice would not send. */
  problem: string | null;
}

export interface SignalResult {
  reports: SignalReport[];
  notifications: Notification[];
  /** The one commit to main: the posts sent. Null when none was. */
  commit: Commit | null;
}

// ---------------------------------------------------------------------------
// signal
// ---------------------------------------------------------------------------

/**
 * One run over the watch list. Every entry inside its drop window that names
 * a subreddit is polled; every matching post not sent before is sent, and
 * then recorded. A notice that will not send is not recorded, so the next run
 * sends it — a duplicate is cheaper than a drop the owner never hears about.
 */
export async function signal(intent: SignalIntent, ports: SignalPorts): Promise<SignalResult> {
  const now = ports.clock.now();
  const stamp = icalStamp(now);
  const state = await readState(ports);
  const listings = new Map<string, RedditPost[] | null>();
  const reports: SignalReport[] = [];
  const notifications: Notification[] = [];

  for (const entry of intent.list) {
    const key = keyOf(entry);
    const cadence = cadenceOf(entry, now);
    const report: SignalReport = { key, festival: entry.festival, cadence, subreddit: entry.subreddit ?? null, outcome: 'nothing', posts: [], problem: null };
    reports.push(report);

    if (!entry.subreddit) {
      report.outcome = 'no-subreddit';
      continue;
    }
    if (cadence === 'dormant' || (!intent.force && cadence !== 'hourly')) {
      report.outcome = cadence === 'dormant' ? 'dormant' : 'not-due';
      continue;
    }

    // Reddit compares subreddit names without case; so does the one request.
    const name = entry.subreddit.toLowerCase();
    if (!listings.has(name)) {
      const text = await ports.reddit.listing(entry.subreddit);
      listings.set(name, text === null ? null : postsIn(text));
    }
    const posts = listings.get(name);
    if (!posts) {
      report.outcome = 'unreachable';
      continue;
    }

    const sent = state.entries[key] ?? {};
    const fresh = posts.filter((p) => !sent[p.id] && isSignal(p, entry)).sort((a, b) => b.score - a.score);
    for (const post of fresh) {
      const notification: Notification = {
        kind: 'signal',
        editionPath: key,
        title: `Set times on Reddit: ${entry.festival} ${entry.year}`,
        body: post.link,
      };
      try {
        await ports.notify.send(notification);
      } catch (err) {
        report.problem = `The notice for ${post.link} would not send (${(err as Error).message}).`;
        continue;
      }
      notifications.push(notification);
      sent[post.id] = { link: post.link, at: stamp };
      state.entries[key] = sent;
      report.posts.push(post.link);
      report.outcome = 'signal';
    }
  }

  let commit: Commit | null = null;
  if (notifications.length > 0) {
    commit = {
      message: `Signal: ${reports.filter((r) => r.outcome === 'signal').map((r) => `${r.festival} ${r.key.slice(-4)} on r/${r.subreddit}`).join('; ')}`,
      files: [{ path: SIGNAL_STATE_PATH, contents: committedJson({ $comment: state.$comment ?? SIGNAL_COMMENT, entries: sortKeys(state.entries) }) }],
      images: [],
    };
    await ports.repo.commit(commit);
  }
  return { reports, notifications, commit };
}

async function readState(ports: SignalPorts): Promise<SignalState> {
  const text = await ports.repo.readFile(SIGNAL_STATE_PATH);
  if (text === null) return { entries: {} };
  const parsed = JSON.parse(text) as Partial<SignalState>;
  return { ...(parsed.$comment ? { $comment: parsed.$comment } : {}), entries: parsed.entries ?? {} };
}
