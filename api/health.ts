/**
 * GET  /api/health           which deployment is live, and which secrets are set
 * POST /api/health {owner}   with the owner secret: also prove the keys work
 *
 * The thin deployment wrapper over `src/secrets.ts`. Reports presence and
 * provider status only — never a value. A wrong owner secret gets exactly the
 * GET response, so nothing about the secret leaks through a mismatch.
 * `scripts/provision-secrets.sh` polls this after a deploy.
 */

import { liveChecks, ownerMatches, secretPresence } from '../src/secrets.js';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2) + '\n', {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function base() {
  return {
    deployment: process.env['VERCEL_GIT_COMMIT_SHA'] ?? null,
    env: process.env['VERCEL_ENV'] ?? null,
    secrets: secretPresence(process.env),
  };
}

export function GET(): Response {
  return json(base());
}

export async function POST(request: Request): Promise<Response> {
  let candidate: unknown;
  try {
    const body = (await request.json()) as unknown;
    candidate = body && typeof body === 'object' ? (body as { owner?: unknown }).owner : undefined;
  } catch {
    candidate = undefined;
  }
  if (!ownerMatches(process.env, candidate)) return json(base());
  return json({ ...base(), owner: true, live: await liveChecks(process.env, fetch) });
}
