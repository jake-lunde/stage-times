/**
 * The live ports, driven with a fake fetch: what they ask GitHub for, in what
 * order. No network. The rules are in src/publisher.ts and tested there; this
 * checks only that the adapter does what the port promises.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { envOwner, githubNotifier, githubRepository, livePages } from '../src/ports.js';
import type { PullRequest } from '../src/publisher.js';

interface Call {
  method: string;
  path: string;
  body: Record<string, unknown> | null;
}

/** A GitHub that answers every write with a fresh sha and records the call. */
function fakeGitHub(): { calls: Call[]; fetch: (input: string, init?: RequestInit) => Promise<Response> } {
  const calls: Call[] = [];
  let n = 0;
  return {
    calls,
    async fetch(input, init) {
      const path = input.replace('https://api.github.com', '');
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
      calls.push({ method: init?.method ?? 'GET', path, body });
      n += 1;
      const answer = path.endsWith('/git/ref/heads/main')
        ? { object: { sha: 'main-head' } }
        : path.includes('/git/commits/')
          ? { tree: { sha: `tree-of-${path.split('/').at(-1)}` } }
          : { sha: `sha-${n}` };
      return new Response(JSON.stringify(answer), { status: 201 });
    },
  };
}

const PR: PullRequest = {
  from: 'publish-commit',
  branch: 'list/fan/low-tide-2026',
  title: 'List Low Tide 2026',
  body: 'Low Tide 2026: 5 sets across 2 stages.',
  commit: { message: 'List Low Tide 2026 (fan/low-tide-2026)', files: [{ path: 'state/published.json', contents: '{}\n' }], images: [] },
};

test('ports: commit returns the new commit sha, for a pull request to branch from', async () => {
  const gh = fakeGitHub();
  const repo = githubRepository({ GITHUB_TOKEN: 't' }, gh.fetch, 'o/r');
  const sha = await repo.commit({ message: 'm', files: [{ path: 'a', contents: 'b' }], images: [] });
  const commitWrite = gh.calls.findIndex((c) => c.path === '/repos/o/r/git/commits' && c.method === 'POST');
  assert.ok(commitWrite >= 0, 'a commit was written');
  const refUpdate = gh.calls.at(-1)!;
  assert.equal(refUpdate.path, '/repos/o/r/git/refs/heads/main');
  assert.equal(refUpdate.body!['sha'], sha, 'main moves to the commit whose sha is returned');
});

test('ports: a listing pull request branches off the publish commit and opens against main', async () => {
  const gh = fakeGitHub();
  await githubRepository({ GITHUB_TOKEN: 't' }, gh.fetch, 'o/r').openPullRequest(PR);

  const [branch] = gh.calls;
  assert.deepEqual(branch, {
    method: 'POST',
    path: '/repos/o/r/git/refs',
    body: { ref: 'refs/heads/list/fan/low-tide-2026', sha: 'publish-commit' },
  });
  const commit = gh.calls.find((c) => c.path === '/repos/o/r/git/commits' && c.method === 'POST')!;
  assert.deepEqual(commit.body!['parents'], ['publish-commit']);
  assert.ok(
    gh.calls.some((c) => c.method === 'PATCH' && c.path === '/repos/o/r/git/refs/heads/list/fan/low-tide-2026'),
    'the branch, never main, moves to the listing commit',
  );
  assert.ok(!gh.calls.some((c) => c.method === 'PATCH' && c.path.endsWith('/refs/heads/main')), 'main is untouched');
  const pull = gh.calls.at(-1)!;
  assert.deepEqual(pull, {
    method: 'POST',
    path: '/repos/o/r/pulls',
    body: { title: PR.title, body: PR.body, head: PR.branch, base: 'main' },
  });
});

test('ports: the owner port recognizes OWNER_SECRET and nothing else, set or unset', () => {
  assert.equal(envOwner({ OWNER_SECRET: 's3cret' }).recognizes('s3cret'), true);
  assert.equal(envOwner({ OWNER_SECRET: 's3cret' }).recognizes('s3cre'), false);
  assert.equal(envOwner({ OWNER_SECRET: 's3cret' }).recognizes(undefined), false);
  assert.equal(envOwner({}).recognizes('s3cret'), false);
  assert.equal(envOwner({ OWNER_SECRET: '' }).recognizes(''), false);
});

// ---------------------------------------------------------------------------
// Pages and issues, for the watcher
// ---------------------------------------------------------------------------

/** A site that answers each URL as told, and records how it was asked. */
function fakeSite(answers: Record<string, { status?: number; type?: string; body: string | Uint8Array }>) {
  const asked: { url: string; init: RequestInit | undefined }[] = [];
  return {
    asked,
    async fetch(url: string, init?: RequestInit): Promise<Response> {
      asked.push({ url, init });
      const a = answers[url];
      if (!a) return new Response('not here', { status: 404 });
      return new Response(a.body, { status: a.status ?? 200, headers: a.type ? { 'content-type': a.type } : {} });
    },
  };
}

test('ports: the page port answers with HTML for a page and nothing for anything else, and says who it is', async () => {
  const site = fakeSite({
    'https://fest.example/schedule': { type: 'text/html; charset=utf-8', body: '<html><img src="a.png"></html>' },
    'https://fest.example/feed.json': { type: 'application/json', body: '{}' },
    'https://fest.example/gone': { status: 404, type: 'text/html', body: 'gone' },
  });
  const pages = livePages(site.fetch);
  assert.equal(await pages.page('https://fest.example/schedule'), '<html><img src="a.png"></html>');
  assert.equal(await pages.page('https://fest.example/feed.json'), null, 'not a page');
  assert.equal(await pages.page('https://fest.example/gone'), null);
  assert.equal(await pages.page('https://fest.example/nowhere'), null);
  const ua = (site.asked[0]!.init!.headers as Record<string, string>)['User-Agent'];
  assert.match(ua!, /stage-times-watcher.*stagetimes\.app/, 'identifies itself honestly');
});

test('ports: the page port answers with bytes and the served type for an image, nothing for a miss', async () => {
  const bytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  const site = fakeSite({
    'https://cdn.example/a.png': { type: 'image/png', body: bytes },
    'https://cdn.example/b.png': { body: bytes },
  });
  const pages = livePages(site.fetch);
  const a = await pages.image('https://cdn.example/a.png');
  assert.deepEqual(a, { bytes, contentType: 'image/png' });
  const b = await pages.image('https://cdn.example/b.png');
  assert.deepEqual(b, { bytes }, 'no type served, none claimed — the bytes have the last word');
  assert.equal(await pages.image('https://cdn.example/nope.png'), null);
});

test('ports: an issue with nobody behind it carries no uploader line', async () => {
  const gh = fakeGitHub();
  const notify = githubNotifier({ GITHUB_TOKEN: 't' }, gh.fetch, 'o/r');
  await notify.send({ kind: 'watch-failed', editionPath: 'low-tide-2026', title: 'Watcher: Low Tide 2026 could not be read', body: 'The images read as 2025.' });
  await notify.send({ kind: 'edition-published', editionPath: 'fan/low-tide-2026', title: 'Fan edition published', body: 'Live.', email: 'sam@example.com' });
  const [machine, fan] = gh.calls.filter((c) => c.path === '/repos/o/r/issues');
  assert.equal(machine!.body!['body'], 'The images read as 2025.');
  assert.deepEqual(machine!.body!['labels'], ['watch-failed']);
  assert.equal(fan!.body!['body'], 'Live.\n\nUploader: sam@example.com');
});
