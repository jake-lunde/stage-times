/**
 * The live ports, driven with a fake fetch: what they ask GitHub for, in what
 * order. No network. The rules are in src/publisher.ts and tested there; this
 * checks only that the adapter does what the port promises.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';

import { envOwner, githubRepository, liveWeb } from '../src/ports.js';

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

test('ports: commit returns the new commit sha', async () => {
  const gh = fakeGitHub();
  const repo = githubRepository({ GITHUB_TOKEN: 't' }, gh.fetch, 'o/r');
  const sha = await repo.commit({ message: 'm', files: [{ path: 'a', contents: 'b' }], images: [] });
  const commitWrite = gh.calls.findIndex((c) => c.path === '/repos/o/r/git/commits' && c.method === 'POST');
  assert.ok(commitWrite >= 0, 'a commit was written');
  const refUpdate = gh.calls.at(-1)!;
  assert.equal(refUpdate.path, '/repos/o/r/git/refs/heads/main');
  assert.equal(refUpdate.body!['sha'], sha, 'main moves to the commit whose sha is returned');
});

test('ports: the owner port recognizes OWNER_SECRET and nothing else, set or unset', () => {
  assert.equal(envOwner({ OWNER_SECRET: 's3cret' }).recognizes('s3cret'), true);
  assert.equal(envOwner({ OWNER_SECRET: 's3cret' }).recognizes('s3cre'), false);
  assert.equal(envOwner({ OWNER_SECRET: 's3cret' }).recognizes(undefined), false);
  assert.equal(envOwner({}).recognizes('s3cret'), false);
  assert.equal(envOwner({ OWNER_SECRET: '' }).recognizes(''), false);
});

// ---------------------------------------------------------------------------
// The web port, against a real server on this machine
// ---------------------------------------------------------------------------

/**
 * A server on loopback — which is exactly what the web port must never reach
 * unless a test widens what it allows. Records every path it was asked for.
 */
async function localSite(): Promise<{ server: Server; port: number; asked: string[] }> {
  const asked: string[] = [];
  const server = createServer((req, res) => {
    asked.push(req.url ?? '');
    const port = (server.address() as AddressInfo).port;
    if (req.url === '/moved') {
      res.writeHead(302, { Location: '/schedule' }).end();
    } else if (req.url === '/to-internal') {
      res.writeHead(302, { Location: `http://internal.test:${port}/secret` }).end();
    } else if (req.url === '/schedule') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Encoding': 'gzip' }).end(gzipSync('<img src="/day.png">'));
    } else if (req.url === '/day.png') {
      res.writeHead(200, { 'Content-Type': 'image/png' }).end(Buffer.from('png bytes'));
    } else {
      res.writeHead(404, { 'Content-Type': 'text/html' }).end('Not found');
    }
  });
  await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready));
  return { server, port: (server.address() as AddressInfo).port, asked };
}

test('ports: the web port will not connect to a loopback address, however it is reached', async () => {
  const site = await localSite();
  try {
    const web = liveWeb({ resolve: async (host) => (host === 'loopback.test' ? ['127.0.0.1'] : []) });
    assert.equal(await web.page(`http://127.0.0.1:${site.port}/schedule`), null, 'an IP typed straight in');
    assert.equal(await web.page(`http://loopback.test:${site.port}/schedule`), null, 'a name that resolves to loopback');
    assert.equal(await web.image(`http://127.0.0.1:${site.port}/day.png`), null, 'an image');
    assert.deepEqual(site.asked, [], 'the server was never asked for anything');
  } finally {
    site.server.close();
  }
});

test('ports: the web port checks every redirect at connect time, so a public page cannot bounce it somewhere private', async () => {
  const site = await localSite();
  try {
    // Loopback stands in for the public internet here; internal.test is the private network.
    const web = liveWeb({
      resolve: async (host) => (host === 'public.test' ? ['127.0.0.1'] : host === 'internal.test' ? ['10.0.0.1'] : []),
      allow: (address) => address === '127.0.0.1',
    });
    assert.equal(await web.page(`http://public.test:${site.port}/to-internal`), null, 'the redirect to a private address goes nowhere');
    assert.deepEqual(site.asked, ['/to-internal'], 'only the public page was asked for');
  } finally {
    site.server.close();
  }
});

test('ports: the web port follows redirects, decompresses, and answers with the status, the final address and the body', async () => {
  const site = await localSite();
  try {
    const web = liveWeb({ resolve: async () => ['127.0.0.1'], allow: () => true });
    const page = await web.page(`http://site.test:${site.port}/moved`);
    assert.deepEqual(page, {
      status: 200,
      url: `http://site.test:${site.port}/schedule`,
      contentType: 'text/html; charset=utf-8',
      html: '<img src="/day.png">',
    });
    const missing = await web.page(`http://site.test:${site.port}/nothing`);
    assert.equal(missing?.status, 404, 'a 404 is an answer, for the publisher to read');

    const image = await web.image(`http://site.test:${site.port}/day.png`);
    assert.deepEqual(image, { bytes: new Uint8Array(Buffer.from('png bytes')), contentType: 'image/png' });
    assert.equal(await web.image(`http://site.test:${site.port}/nothing.png`), null, 'a missing image is nothing');
    assert.deepEqual(await web.resolve('site.test'), ['127.0.0.1'], 'resolve is the resolver');
  } finally {
    site.server.close();
  }
});
