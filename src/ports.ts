/**
 * Stage Times — the live implementations of the publisher's ports.
 *
 * `src/publisher.ts` holds the rules and never touches the outside world; this
 * module is the outside world, and holds no rules. Everything here is one of
 * five things: the vision model (through `src/vision.ts`, still the only module
 * that calls a model), the repository, notifications, the clock, and
 * randomness. Nothing here decides anything.
 *
 * The repository port commits through GitHub's Git Data API rather than the
 * Contents API, one blob per file and one tree per intent, because an edition
 * is its YAML *and* its log *and* the state update: a half-applied publish is
 * an edition whose feeds exist and whose state does not. Reads are plain
 * Contents API calls, one file each.
 *
 * Secrets come from the environment, named in `src/secrets.ts`:
 * `ANTHROPIC_API_KEY` pays for vision, `GITHUB_TOKEN` writes the repository
 * and opens listing pull requests, `OWNER_SECRET` is what the owner port
 * checks a presented secret against.
 *
 * Deployment note: `config/vision-models.json` must be bundled with the
 * serverless functions (`includeFiles` in vercel.json) — the model choice is
 * configuration and the function reads it at call time.
 */

import { randomBytes } from 'node:crypto';
import { loadVisionConfig, withModelFallback } from './models.js';
import {
  PUBLISHED_PATH,
  UPLOADS_PATH,
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
  type UploadLedger,
  type VisionPort,
} from './publisher.js';
import { ownerMatches, PUBLISHER_REPO, type Env } from './secrets.js';
import { requireSdkBackend, screenForSchedule, transcribeBytes } from './vision.js';
import type { PublishedFile } from './build.js';

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
 * Fan editions commit straight to main by design (spec: no pull request per
 * upload) — the uploader's confirm is the human check, and a pull request
 * nobody merges is a draft tier, which this product does not have. The one
 * pull request is the listing: a branch off the publish commit, opened against
 * main, for the owner to merge from the GitHub app.
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
    async readUploads() {
      return readJson<UploadLedger>(UPLOADS_PATH, { uploads: [] });
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
          body: `${notification.body}\n\nUploader: ${notification.email}`,
          labels: [notification.kind],
        }),
      });
      if (!res.ok) throw new GitHubError('issue write', res.status, await res.text().catch(() => ''));
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
