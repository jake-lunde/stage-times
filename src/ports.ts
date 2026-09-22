/**
 * Stage Times — the live implementations of the publisher's ports.
 *
 * `src/publisher.ts` holds the rules and never touches the outside world; this
 * module is the outside world, and holds no rules. Everything here is one of
 * eight things: the vision model (through `src/vision.ts`, still the only
 * module that calls a model), the repository, notifications, the clock,
 * randomness, the schedule pages the watcher reads, the web a stranger's link
 * points at, and the subreddit listings the signal reads. Nothing here decides
 * anything — the one exception is that the web port will not connect to an
 * address the publisher would refuse, because only the port sees where a name
 * resolves at the moment it connects.
 *
 * The repository port commits through GitHub's Git Data API rather than the
 * Contents API, one blob per file and one tree per intent, because an edition
 * is its YAML *and* its log *and* the state update: a half-applied publish is
 * an edition whose feeds exist and whose state does not. Reads are plain
 * Contents API calls, one file each.
 *
 * Secrets come from the environment, named in `src/secrets.ts`:
 * `ANTHROPIC_API_KEY` pays for vision, `GITHUB_TOKEN` writes the repository
 * and opens the watcher's review pull requests, `OWNER_SECRET` is what the owner port
 * checks a presented secret against.
 *
 * Deployment note: `config/vision-models.json` must be bundled with the
 * serverless functions (`includeFiles` in vercel.json) — the model choice is
 * configuration and the function reads it at call time.
 */

import { randomBytes } from 'node:crypto';
import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';
import { loadVisionConfig, withModelFallback } from './models.js';
import {
  PUBLISHED_PATH,
  TRANSCRIPTION_STORE_DIR,
  type ClockPort,
  type Commit,
  type Notification,
  type NotifyPort,
  type OwnerPort,
  type PublisherPorts,
  type PullRequest,
  type RandomPort,
  type RepositoryPort,
  type SavedTranscription,
  type ScheduleCheck,
  type SourceImage,
  type VisionPort,
  type LinkPorts,
  type WebPort,
} from './publisher.js';
import { ownerMatches, PUBLISHER_REPO, type Env } from './secrets.js';
import { requireSdkBackend, screenForSchedule, transcribeBytes } from './vision.js';
import type { PublishedFile } from './build.js';
import type { FetchedImage, PagePort, WatcherPorts } from './watcher.js';
import type { RedditPort, SignalPorts } from './signal.js';
import { hostOf, isPublicAddress, type WebPage } from './web.js';

const API = 'https://api.github.com';
const BRANCH = 'main';

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

// ---------------------------------------------------------------------------
// Clock and randomness
// ---------------------------------------------------------------------------

/** The wall clock. The build never reads one; the publisher reads this one. */
export function systemClock(): ClockPort {
  return { now: () => Date.now() };
}

export function cryptoRandom(): RandomPort {
  return { bytes: (n) => randomBytes(n) };
}

// ---------------------------------------------------------------------------
// The owner
// ---------------------------------------------------------------------------

/**
 * Checks a presented secret against OWNER_SECRET, in constant time. Unset,
 * empty, wrong and missing all answer no, indistinguishably.
 */
export function envOwner(env: Env = process.env): OwnerPort {
  return { recognizes: (presented) => ownerMatches(env, presented) };
}

// ---------------------------------------------------------------------------
// Vision
// ---------------------------------------------------------------------------

/**
 * The model, through src/vision.ts. Two calls, two models: the cheap screen the
 * config names, then the configured transcription model with its proven
 * fallback behind it.
 */
export function liveVision(env: Env = process.env): VisionPort {
  const config = loadVisionConfig();
  const backend = requireSdkBackend(env);
  const asBytes = (image: SourceImage) => ({
    bytes: image.bytes,
    mediaType: image.contentType,
    name: image.filename,
  });

  return {
    async looksLikeSchedule(image): Promise<ScheduleCheck> {
      const verdict = await screenForSchedule(asBytes(image), { backend, model: config.screen, config });
      return { isSchedule: verdict.isSchedule, saw: verdict.saw };
    },
    async transcribe(image): Promise<string> {
      const attempt = await withModelFallback(config, env, (model) =>
        transcribeBytes(asBytes(image), { backend, model, config }),
      );
      return attempt.result.output;
    },
  };
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export class GitHubError extends Error {
  readonly status: number;
  constructor(what: string, status: number, body: string) {
    super(`GitHub ${what} answered HTTP ${status}: ${body.slice(0, 300)}`);
    this.name = 'GitHubError';
    this.status = status;
  }
}

/**
 * Commits every intent to `main` through the Git Data API.
 *
 * The owner's confirm commits straight to main by design — the tap is the
 * human check, and a pull request nobody merges is a draft tier, which this
 * product does not have. The one pull request is the watcher's review: a
 * branch off the run's state commit, opened against main, for the owner to
 * merge from the GitHub app.
 */
export function githubRepository(
  env: Env = process.env,
  fetchFn: FetchLike = fetch,
  repo: string = PUBLISHER_REPO,
): RepositoryPort {
  const token = env['GITHUB_TOKEN'];
  if (!token) throw new Error('GITHUB_TOKEN is not set — the publisher cannot write the repository');

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'stage-times-publisher',
    'Content-Type': 'application/json',
  };

  async function call<T>(what: string, path: string, init?: RequestInit): Promise<T> {
    const res = await fetchFn(`${API}${path}`, { ...init, headers });
    if (!res.ok) throw new GitHubError(what, res.status, await res.text().catch(() => ''));
    return (await res.json()) as T;
  }

  async function readText(path: string): Promise<string | null> {
    const res = await fetchFn(`${API}/repos/${repo}/contents/${path}?ref=${BRANCH}`, { headers });
    if (res.status === 404) return null;
    if (!res.ok) throw new GitHubError(`read of ${path}`, res.status, await res.text().catch(() => ''));
    const body = (await res.json()) as { content?: string; encoding?: string };
    if (!body.content) return null;
    return Buffer.from(body.content, 'base64').toString('utf8');
  }

  async function readJson<T>(path: string, fallback: T): Promise<T> {
    const text = await readText(path);
    return text === null ? fallback : (JSON.parse(text) as T);
  }

  /** One commit on `branch`, whose head must still be `parent`. Returns the new commit's sha. */
  async function commitOnto(branch: string, parent: string, commit: Commit): Promise<string> {
    const base = await call<{ tree: { sha: string } }>('commit read', `/repos/${repo}/git/commits/${parent}`);

    const blobs = await Promise.all([
      ...commit.files.map(async (f) => ({
        path: f.path,
        sha: (
          await call<{ sha: string }>('blob write', `/repos/${repo}/git/blobs`, {
            method: 'POST',
            body: JSON.stringify({ content: f.contents, encoding: 'utf-8' }),
          })
        ).sha,
      })),
      ...commit.images.map(async (i) => ({
        path: i.path,
        sha: (
          await call<{ sha: string }>('blob write', `/repos/${repo}/git/blobs`, {
            method: 'POST',
            body: JSON.stringify({ content: Buffer.from(i.bytes).toString('base64'), encoding: 'base64' }),
          })
        ).sha,
      })),
    ]);

    const tree = await call<{ sha: string }>('tree write', `/repos/${repo}/git/trees`, {
      method: 'POST',
      body: JSON.stringify({
        base_tree: base.tree.sha,
        tree: blobs.map((b) => ({ path: b.path, mode: '100644', type: 'blob', sha: b.sha })),
      }),
    });

    const created = await call<{ sha: string }>('commit write', `/repos/${repo}/git/commits`, {
      method: 'POST',
      body: JSON.stringify({ message: commit.message, tree: tree.sha, parents: [parent] }),
    });

    // No force: a concurrent publish makes this fail loudly rather than
    // dropping somebody else's edition on the floor.
    await call('ref update', `/repos/${repo}/git/refs/heads/${branch}`, {
      method: 'PATCH',
      body: JSON.stringify({ sha: created.sha, force: false }),
    });
    return created.sha;
  }

  return {
    async readPublished() {
      return readJson<PublishedFile>(PUBLISHED_PATH, { publishedAt: '', editions: {} });
    },
    async readTranscription(hash) {
      return readJson<SavedTranscription | null>(`${TRANSCRIPTION_STORE_DIR}/${hash}.json`, null);
    },
    async readFile(path) {
      return readText(path);
    },
    async commit(commit: Commit) {
      const ref = await call<{ object: { sha: string } }>(
        'ref read',
        `/repos/${repo}/git/ref/heads/${BRANCH}`,
      );
      if (commit.files.length === 0 && commit.images.length === 0) return ref.object.sha;
      return commitOnto(BRANCH, ref.object.sha, commit);
    },
    async openPullRequest(pr: PullRequest) {
      await call('branch write', `/repos/${repo}/git/refs`, {
        method: 'POST',
        body: JSON.stringify({ ref: `refs/heads/${pr.branch}`, sha: pr.from }),
      });
      await commitOnto(pr.branch, pr.from, pr.commit);
      await call('pull request write', `/repos/${repo}/pulls`, {
        method: 'POST',
        body: JSON.stringify({ title: pr.title, body: pr.body, head: pr.branch, base: BRANCH }),
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

/**
 * GitHub is the alert channel for everything machine-initiated (spec). An issue
 * lands in the owner's inbox; nothing is ever emailed, to anyone, by anything.
 * The repository is public, so its issues are too: an issue carries the
 * notice's title and body and nothing else.
 */
export function githubNotifier(
  env: Env = process.env,
  fetchFn: FetchLike = fetch,
  repo: string = PUBLISHER_REPO,
): NotifyPort {
  const token = env['GITHUB_TOKEN'];
  if (!token) throw new Error('GITHUB_TOKEN is not set — the publisher cannot reach the owner');
  return {
    async send(notification: Notification) {
      const res = await fetchFn(`${API}/repos/${repo}/issues`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'stage-times-publisher',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: notification.title,
          body: notification.body,
          labels: [notification.kind],
        }),
      });
      if (!res.ok) throw new GitHubError('issue write', res.status, await res.text().catch(() => ''));
    },
  };
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

/** How long one page or one image may take to answer. */
export const PAGE_TIMEOUT_MS = 30_000;
/** The most an image on a schedule page is read in; the publisher refuses anything larger anyway. */
const MAX_FETCHED_IMAGE_BYTES = 10 * 1024 * 1024;

/**
 * The watcher's read of the outside world: a festival's schedule page and the
 * images on it, over plain HTTP, identifying itself honestly. Anything that
 * does not answer with a page or an image — a timeout, a 404, a login wall
 * serving HTML for an image — is null, and the watcher treats null as
 * "not there", never as a change.
 */
export function livePages(fetchFn: FetchLike = fetch): PagePort {
  const agent = 'stage-times-watcher/1.0 (+https://stagetimes.app)';
  return {
    async page(url): Promise<string | null> {
      try {
        const res = await fetchFn(url, {
          headers: { 'User-Agent': agent, Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5' },
          signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
        });
        if (!res.ok) return null;
        const type = res.headers.get('content-type') ?? '';
        if (type && !/html|xml/i.test(type)) return null;
        return await res.text();
      } catch {
        return null;
      }
    },
    async image(url): Promise<FetchedImage | null> {
      try {
        const res = await fetchFn(url, {
          headers: { 'User-Agent': agent, Accept: 'image/*,*/*;q=0.5' },
          signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
        });
        if (!res.ok) return null;
        if (Number(res.headers.get('content-length') ?? 0) > MAX_FETCHED_IMAGE_BYTES) return null;
        const bytes = new Uint8Array(await res.arrayBuffer());
        if (bytes.byteLength > MAX_FETCHED_IMAGE_BYTES) return null;
        const type = res.headers.get('content-type')?.split(';')[0]?.trim();
        return type ? { bytes, contentType: type } : { bytes };
      } catch {
        return null;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// The web, for a stranger's link
// ---------------------------------------------------------------------------

/** The most of a page read in. A schedule page is a fraction of this. */
const MAX_PAGE_BYTES = 5 * 1024 * 1024;
/** Redirects followed before a link counts as not answering. */
const MAX_REDIRECTS = 5;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);

export interface LiveWebOptions {
  /** Every address a name resolves to. The system resolver by default. */
  resolve?: (hostname: string) => Promise<string[]>;
  /** Which addresses a request may connect to. Public ones only by default; a test may widen it. */
  allow?: (address: string) => boolean;
}

/** An answer as it came off the wire, before anyone decided what it means. */
interface Answer {
  status: number;
  url: string;
  contentType: string;
  body: Buffer;
}

async function systemResolve(hostname: string): Promise<string[]> {
  try {
    return (await dnsLookup(hostname, { all: true, verbatim: true })).map((a) => a.address);
  } catch {
    return [];
  }
}

/**
 * The link intent's read of the web: the page a stranger typed, and the
 * images on it. Redirects are followed by hand, and every connection — the
 * first and each redirect's — goes through a resolver that refuses the whole
 * name if any address it gives is not public, so a name that resolved to a
 * public address for the publisher's check and a private one a moment later
 * still connects nowhere. An address typed as an IP never passes through a
 * resolver, so it is checked here directly. Anything that goes wrong is null
 * — a page that did not answer — and the publisher says so in words.
 */
export function liveWeb(options: LiveWebOptions = {}): WebPort {
  const resolve = options.resolve ?? systemResolve;
  const allow = options.allow ?? isPublicAddress;
  const agent = 'stage-times/1.0 (+https://stagetimes.app)';

  const lookup: LookupFunction = (hostname, opts, callback) => {
    resolve(hostname).then(
      (addresses) => {
        if (addresses.length === 0 || !addresses.every(allow)) {
          callback(Object.assign(new Error(`${hostname} does not resolve to a public address`), { code: 'ENOTFOUND' }), '', 0);
          return;
        }
        const all = addresses.map((address) => ({ address, family: isIP(address) }));
        if (opts.all) (callback as unknown as (err: null, list: typeof all) => void)(null, all);
        else callback(null, all[0]!.address, all[0]!.family);
      },
      (err: Error) => callback(err as NodeJS.ErrnoException, '', 0),
    );
  };

  function once(target: URL, accept: string, maxBytes: number): Promise<(Answer & { location: string | null }) | null> {
    return new Promise((resolveAnswer) => {
      // One deadline for the whole answer, not just a quiet socket: a server
      // that drips a byte at a time does not get to hold the function open.
      const deadline = setTimeout(() => req.destroy(), PAGE_TIMEOUT_MS);
      const done = (answer: (Answer & { location: string | null }) | null) => {
        clearTimeout(deadline);
        resolveAnswer(answer);
      };
      const send = target.protocol === 'https:' ? httpsRequest : httpRequest;
      const req = send(
        target,
        {
          method: 'GET',
          headers: { 'User-Agent': agent, Accept: accept, 'Accept-Encoding': 'gzip, deflate, br' },
          lookup,
        },
        (res: IncomingMessage) => {
          const status = res.statusCode ?? 0;
          const location = typeof res.headers.location === 'string' ? res.headers.location : null;
          const contentType = String(res.headers['content-type'] ?? '');
          if (REDIRECTS.has(status)) {
            res.resume();
            done({ status, url: target.href, contentType, body: Buffer.alloc(0), location });
            return;
          }
          const encoding = String(res.headers['content-encoding'] ?? '').toLowerCase();
          const stream =
            encoding === 'gzip' || encoding === 'x-gzip'
              ? res.pipe(createGunzip())
              : encoding === 'deflate'
                ? res.pipe(createInflate())
                : encoding === 'br'
                  ? res.pipe(createBrotliDecompress())
                  : res;
          const chunks: Buffer[] = [];
          let size = 0;
          stream.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > maxBytes) {
              req.destroy();
              done(null);
              return;
            }
            chunks.push(chunk);
          });
          stream.on('end', () => done({ status, url: target.href, contentType, body: Buffer.concat(chunks), location: null }));
          stream.on('error', () => done(null));
        },
      );
      req.on('error', () => done(null));
      req.end();
    });
  }

  async function get(url: string, accept: string, maxBytes: number): Promise<Answer | null> {
    let current: URL;
    try {
      current = new URL(url);
    } catch {
      return null;
    }
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      if (current.protocol !== 'http:' && current.protocol !== 'https:') return null;
      if (current.username !== '' || current.password !== '') return null;
      const host = hostOf(current);
      if (isIP(host) && !allow(host)) return null;
      const answer = await once(current, accept, maxBytes);
      if (!answer) return null;
      if (!REDIRECTS.has(answer.status) || !answer.location) return answer;
      try {
        current = new URL(answer.location, current);
      } catch {
        return null;
      }
    }
    return null;
  }

  return {
    resolve,
    async page(url): Promise<WebPage | null> {
      const answer = await get(url, 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5', MAX_PAGE_BYTES);
      if (!answer) return null;
      return { status: answer.status, url: answer.url, contentType: answer.contentType, html: answer.body.toString('utf8') };
    },
    async image(url): Promise<FetchedImage | null> {
      const answer = await get(url, 'image/*,*/*;q=0.5', MAX_FETCHED_IMAGE_BYTES);
      if (!answer || answer.status < 200 || answer.status > 299) return null;
      const bytes = new Uint8Array(answer.body);
      const type = answer.contentType.split(';')[0]?.trim();
      return type ? { bytes, contentType: type } : { bytes };
    },
  };
}

// ---------------------------------------------------------------------------
// Subreddit listings
// ---------------------------------------------------------------------------

/**
 * Who the signal says it is, in the form Reddit's API rules ask for —
 * `<platform>:<app id>:<version>` — with the site behind it.
 */
export const REDDIT_USER_AGENT = 'web:app.stagetimes.signal:v1.0 (+https://stagetimes.app)';

/**
 * The gap between two listing requests in one run. Reddit allows a client
 * without credentials far less than an OAuth one; ten a minute is the
 * commonly stated ceiling, and this stays at it. A run asks once per
 * subreddit and runs hourly, so the spacing is the only limit that ever binds.
 */
export const REDDIT_REQUEST_SPACING_MS = 6_000;

/**
 * The signal's read of Reddit: a subreddit's newest posts over the public
 * JSON listing, with no credentials, identifying itself honestly and pacing
 * itself. After a 429, or once Reddit's `x-ratelimit-remaining` says the
 * budget is spent, it asks nothing more this run. Anything that is not a
 * JSON answer — a block page, a login wall, an error — is null, and the
 * signal treats null as "not there".
 */
export function liveReddit(
  fetchFn: FetchLike = fetch,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): RedditPort {
  let asked = 0;
  let stopped = false;
  return {
    async listing(subreddit): Promise<string | null> {
      if (stopped) return null;
      if (asked > 0) await sleep(REDDIT_REQUEST_SPACING_MS);
      asked += 1;
      try {
        const res = await fetchFn(`https://www.reddit.com/r/${encodeURIComponent(subreddit)}/new.json?limit=100&raw_json=1`, {
          headers: { 'User-Agent': REDDIT_USER_AGENT, Accept: 'application/json' },
          signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
        });
        const remaining = res.headers.get('x-ratelimit-remaining');
        if (res.status === 429 || (remaining !== null && Number(remaining) < 1)) stopped = true;
        if (!res.ok) return null;
        if (!/json/i.test(res.headers.get('content-type') ?? '')) return null;
        return await res.text();
      } catch {
        return null;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// The set
// ---------------------------------------------------------------------------

/** Every port, live. What the serverless adapters hand the publisher. */
export function livePorts(env: Env = process.env): PublisherPorts {
  return {
    vision: liveVision(env),
    repo: githubRepository(env),
    notify: githubNotifier(env),
    clock: systemClock(),
    random: cryptoRandom(),
    owner: envOwner(env),
  };
}

/** The publisher's ports plus the pages. What the scheduled entrypoint hands the watcher. */
export function watcherPorts(env: Env = process.env): WatcherPorts {
  return { ...livePorts(env), pages: livePages() };
}

/** The publisher's ports plus the web. What the link adapter hands the publisher. */
export function linkPorts(env: Env = process.env): LinkPorts {
  return { ...livePorts(env), web: liveWeb() };
}

/** The publisher's ports plus Reddit. What the scheduled entrypoint hands the signal. */
export function signalPorts(env: Env = process.env): SignalPorts {
  return { ...livePorts(env), reddit: liveReddit() };
}
