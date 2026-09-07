/**
 * Secrets: presence, the owner match, and the live checks — all with fakes,
 * and none of them may ever surface a secret value.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { liveChecks, ownerMatches, secretPresence, SECRET_NAMES } from '../src/secrets.js';

const KEY = 'sk-ant-test-0123456789';
const TOKEN = 'github_pat_test_ABCDEFG';
const OWNER = 'a3f9c2e1d4b5a6f7e8d9c0b1a2f3e4d5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1';

test('secrets: the three names are the ones the code and the wizard agree on', () => {
  assert.deepEqual([...SECRET_NAMES], ['ANTHROPIC_API_KEY', 'GITHUB_TOKEN', 'OWNER_SECRET']);
});

test('secrets: presence reports set/unset and never a value', () => {
  assert.deepEqual(secretPresence({}), { ANTHROPIC_API_KEY: false, GITHUB_TOKEN: false, OWNER_SECRET: false });
  const p = secretPresence({ ANTHROPIC_API_KEY: KEY, GITHUB_TOKEN: '', OWNER_SECRET: OWNER });
  assert.deepEqual(p, { ANTHROPIC_API_KEY: true, GITHUB_TOKEN: false, OWNER_SECRET: true });
  assert.equal(JSON.stringify(p).includes(KEY), false, 'no value in the presence report');
});

test('secrets: ownerMatches is true only for the exact secret', () => {
  const env = { OWNER_SECRET: OWNER };
  assert.equal(ownerMatches(env, OWNER), true, 'exact match');
  assert.equal(ownerMatches(env, OWNER.slice(0, -1)), false, 'one char short');
  assert.equal(ownerMatches(env, OWNER + 'x'), false, 'one char long');
  assert.equal(ownerMatches(env, OWNER.toUpperCase()), false, 'case matters');
  assert.equal(ownerMatches(env, ''), false, 'empty candidate');
  assert.equal(ownerMatches(env, undefined), false, 'missing candidate');
  assert.equal(ownerMatches(env, 42), false, 'non-string candidate');
  assert.equal(ownerMatches(env, { owner: OWNER }), false, 'object candidate');
});

test('secrets: an unset owner secret matches nothing, including the empty string', () => {
  assert.equal(ownerMatches({}, ''), false);
  assert.equal(ownerMatches({ OWNER_SECRET: '' }, ''), false);
  assert.equal(ownerMatches({}, OWNER), false);
});

function fakeFetch(routes: Record<string, { status: number; body?: unknown }>, calls: { url: string; headers: Record<string, string> }[]) {
  return async (url: string, init?: RequestInit): Promise<Response> => {
    calls.push({ url, headers: (init?.headers as Record<string, string>) ?? {} });
    const r = routes[url];
    if (!r) return new Response('not found', { status: 404 });
    return new Response(r.body === undefined ? '' : JSON.stringify(r.body), { status: r.status });
  };
}

test('secrets: live checks pass when both providers accept, and the detail never carries a value', async () => {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const f = fakeFetch(
    {
      'https://api.anthropic.com/v1/models': { status: 200, body: { data: [{ id: 'a' }, { id: 'b' }] } },
      'https://api.github.com/repos/jake-lunde/stage-times': { status: 200, body: { permissions: { push: true, pull: true } } },
    },
    calls,
  );
  const r = await liveChecks({ ANTHROPIC_API_KEY: KEY, GITHUB_TOKEN: TOKEN }, f);
  assert.equal(r.anthropic.ok, true, r.anthropic.detail);
  assert.equal(r.anthropic.status, 200);
  assert.match(r.anthropic.detail, /2 model\(s\)/);
  assert.equal(r.github.ok, true, r.github.detail);
  assert.match(r.github.detail, /can push/);
  const text = JSON.stringify(r);
  assert.equal(text.includes(KEY), false, 'API key leaked into the report');
  assert.equal(text.includes(TOKEN), false, 'token leaked into the report');
  // The credentials went to the providers, and only to the providers.
  assert.equal(calls[0]!.headers['x-api-key'], KEY);
  assert.equal(calls[1]!.headers['Authorization'], `Bearer ${TOKEN}`);
});

test('secrets: live checks fail honestly — unset, rejected, and read-only each say why', async () => {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const rejected = fakeFetch(
    {
      'https://api.anthropic.com/v1/models': { status: 401, body: { error: 'bad key' } },
      'https://api.github.com/repos/jake-lunde/stage-times': { status: 200, body: { permissions: { push: false, pull: true } } },
    },
    calls,
  );
  const r = await liveChecks({ ANTHROPIC_API_KEY: 'wrong', GITHUB_TOKEN: 'readonly' }, rejected);
  assert.equal(r.anthropic.ok, false);
  assert.equal(r.anthropic.status, 401);
  assert.equal(r.github.ok, false);
  assert.match(r.github.detail, /cannot push/);

  const unset = await liveChecks({}, rejected);
  assert.equal(unset.anthropic.ok, false);
  assert.match(unset.anthropic.detail, /not set/);
  assert.equal(unset.github.ok, false);
  assert.match(unset.github.detail, /not set/);
  assert.equal(calls.length, 2, 'no provider call is made for an unset secret');
});

test('secrets: a provider that cannot be reached is a failed check, not a crash', async () => {
  const down = async (): Promise<Response> => {
    throw new Error('ECONNRESET');
  };
  const r = await liveChecks({ ANTHROPIC_API_KEY: KEY, GITHUB_TOKEN: TOKEN }, down);
  assert.equal(r.anthropic.ok, false);
  assert.match(r.anthropic.detail, /could not reach Anthropic/);
  assert.equal(r.github.ok, false);
  assert.match(r.github.detail, /could not reach GitHub/);
});
