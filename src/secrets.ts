/**
 * Stage Times — the three deployment secrets, and how to check them without
 * ever printing one.
 *
 *   ANTHROPIC_API_KEY  vision calls bill the API, never the owner's subscription
 *   GITHUB_TOKEN       fine-grained token: contents + pull requests write on the repo
 *   OWNER_SECRET       what the owner's bookmarked link is checked against
 *
 * Everything here is pure over an env record and an injected fetch, so it is
 * unit-tested with fakes; `api/health.ts` is the thin deployment wrapper that
 * `scripts/provision-secrets.sh` polls after a deploy. No function in this
 * module returns, logs, or embeds a secret value — only presence, HTTP status,
 * and short human-readable detail.
 */

import { createHash, timingSafeEqual } from 'node:crypto';

export const SECRET_NAMES = ['ANTHROPIC_API_KEY', 'GITHUB_TOKEN', 'OWNER_SECRET'] as const;
export type SecretName = (typeof SECRET_NAMES)[number];

export type Env = Record<string, string | undefined>;

/** The repository the GitHub token must be able to push to and open PRs on. */
export const PUBLISHER_REPO = 'jake-lunde/stage-times';

/** Which of the three secrets are set (non-empty). Never the values. */
export function secretPresence(env: Env): Record<SecretName, boolean> {
  return {
    ANTHROPIC_API_KEY: Boolean(env['ANTHROPIC_API_KEY']),
    GITHUB_TOKEN: Boolean(env['GITHUB_TOKEN']),
    OWNER_SECRET: Boolean(env['OWNER_SECRET']),
  };
}

/**
 * Does `candidate` match OWNER_SECRET? Constant-time over SHA-256 digests so
 * neither length nor prefix leaks through timing. An unset secret matches
 * nothing; a non-string candidate matches nothing. A wrong secret is
 * indistinguishable from no secret — callers must not branch on why.
 */
export function ownerMatches(env: Env, candidate: unknown): boolean {
  const secret = env['OWNER_SECRET'];
  if (!secret || typeof candidate !== 'string' || candidate.length === 0) return false;
  const a = createHash('sha256').update(secret, 'utf8').digest();
  const b = createHash('sha256').update(candidate, 'utf8').digest();
  return timingSafeEqual(a, b);
}

export interface LiveCheck {
  /** The secret is set AND the provider accepted it with the access we need. */
  ok: boolean;
  /** HTTP status from the provider, when a call was made. */
  status?: number;
  /** One short line for a human. Never contains a secret. */
  detail: string;
}

export interface LiveChecks {
  anthropic: LiveCheck;
  github: LiveCheck;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Prove each key works, not just that it exists: list models with the
 * Anthropic key (costs no tokens), and read the repo with the GitHub token
 * (the response says whether the token can push). Pull-request write cannot
 * be probed without opening one; the wizard says so.
 */
export async function liveChecks(env: Env, fetchFn: FetchLike, repo: string = PUBLISHER_REPO): Promise<LiveChecks> {
  return {
    anthropic: await checkAnthropic(env['ANTHROPIC_API_KEY'], fetchFn),
    github: await checkGithub(env['GITHUB_TOKEN'], fetchFn, repo),
  };
}

async function checkAnthropic(key: string | undefined, fetchFn: FetchLike): Promise<LiveCheck> {
  if (!key) return { ok: false, detail: 'ANTHROPIC_API_KEY is not set' };
  try {
    const res = await fetchFn('https://api.anthropic.com/v1/models', {
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    });
    if (res.status !== 200) return { ok: false, status: res.status, detail: `Anthropic answered HTTP ${res.status}` };
    const body = (await res.json().catch(() => null)) as { data?: unknown[] } | null;
    const n = Array.isArray(body?.data) ? body!.data!.length : 0;
    return { ok: true, status: 200, detail: `key accepted; ${n} model(s) listed` };
  } catch (err) {
    return { ok: false, detail: `could not reach Anthropic: ${(err as Error).message}` };
  }
}

async function checkGithub(token: string | undefined, fetchFn: FetchLike, repo: string): Promise<LiveCheck> {
  if (!token) return { ok: false, detail: 'GITHUB_TOKEN is not set' };
  try {
    const res = await fetchFn(`https://api.github.com/repos/${repo}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'stage-times-health',
      },
    });
    if (res.status !== 200) return { ok: false, status: res.status, detail: `GitHub answered HTTP ${res.status} for ${repo}` };
    const body = (await res.json().catch(() => null)) as { permissions?: { push?: boolean } } | null;
    const push = body?.permissions?.push === true;
    return push
      ? { ok: true, status: 200, detail: `token can push to ${repo} (pull-request write is not probed)` }
      : { ok: false, status: 200, detail: `token reads ${repo} but cannot push — check Contents: read and write` };
  } catch (err) {
    return { ok: false, detail: `could not reach GitHub: ${(err as Error).message}` };
  }
}
