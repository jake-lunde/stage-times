/**
 * Validation gate 8 — post-deploy smoke test.
 *
 * A script, not a unit test: it needs a live deployment. Run it against the
 * preview URL on every PR and against the apex after a production deploy.
 *
 *   npm run smoke -- https://stagetimes.app
 *   npm run smoke -- https://stage-times-git-branch-you.vercel.app
 *
 * For every feed listed in dist/feeds.json it asserts:
 *   - HTTP 200
 *   - content-type: text/calendar; charset=utf-8   (exactly — no extension sniffing)
 *   - an ETag is present, so well-behaved clients get 304s and polling stays cheap
 *   - valid TLS (fetch refuses an untrusted certificate; .app is HSTS-preloaded so
 *     there is no plain-HTTP fallback for a browser either)
 *   - the body actually begins BEGIN:VCALENDAR
 *   - the body carries no script tag — the analytics snippet is for HTML pages only
 *
 * And for the HTML pages (landing + subscribe) it asserts the inverse: the Vercel
 * Web Analytics script IS present, so a refactor can't silently drop measurement.
 *
 * The last one exists because of Vercel Deployment Protection: a protected preview
 * returns 200 with an HTML login page, which a header-only check happily passes and
 * a calendar client chokes on.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Manifest } from '../src/build.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EXPECTED_CONTENT_TYPE = 'text/calendar; charset=utf-8';

interface Failure {
  url: string;
  problem: string;
}

function usage(msg: string): never {
  process.stderr.write(
    `${msg}\n\n` +
      `usage: npm run smoke -- <base-url>\n` +
      `   e.g. npm run smoke -- https://stagetimes.app\n`,
  );
  process.exit(2);
}

function loadManifest(): Manifest {
  const path = join(REPO_ROOT, 'dist', 'feeds.json');
  if (!existsSync(path)) usage(`No dist/feeds.json — run \`npm run build\` first so the smoke test knows what to poll.`);
  return JSON.parse(readFileSync(path, 'utf8')) as Manifest;
}

async function checkFeed(url: string): Promise<Failure[]> {
  const failures: Failure[] = [];
  const add = (problem: string) => failures.push({ url, problem });

  let res: Response;
  try {
    // HEAD mirrors `curl -I`. Any TLS problem throws here rather than returning.
    res = await fetch(url, { method: 'HEAD', redirect: 'manual' });
  } catch (err) {
    add(`request failed (TLS or DNS?): ${(err as Error).message}`);
    return failures;
  }

  if (res.status !== 200) {
    const location = res.headers.get('location');
    add(`expected HTTP 200, got ${res.status}${location ? ` -> ${location}` : ''}`);
  }

  const contentType = res.headers.get('content-type');
  if (contentType === null) {
    add('no content-type header');
  } else if (contentType.toLowerCase().replace(/;\s*/g, '; ') !== EXPECTED_CONTENT_TYPE) {
    add(`content-type is "${contentType}", expected "${EXPECTED_CONTENT_TYPE}"`);
  }

  const etag = res.headers.get('etag');
  if (etag === null || etag.trim() === '') {
    add('no ETag — subscribers will re-download the whole feed on every poll instead of getting a 304');
  }

  // Body check: a Deployment-Protection login page is a 200 with HTML in it.
  if (res.status === 200) {
    try {
      const body = await (await fetch(url, { redirect: 'manual' })).text();
      if (!body.startsWith('BEGIN:VCALENDAR')) {
        const head = body.slice(0, 80).replace(/\s+/g, ' ');
        add(
          `body does not start with BEGIN:VCALENDAR (got "${head}…"). ` +
            `If this is a preview URL, Vercel Deployment Protection is serving a login page.`,
        );
      } else if (!body.endsWith('END:VCALENDAR\r\n')) {
        add('body does not end with END:VCALENDAR + CRLF — the feed looks truncated');
      } else if (body.includes('_vercel/insights') || body.toLowerCase().includes('<script')) {
        // The Web Analytics snippet belongs to HTML pages only. Calendar clients
        // don't run JS; a script tag here breaks parsers and tracks nobody.
        add('feed body contains the analytics script — analytics must never leak into .ics responses');
      }
    } catch (err) {
      add(`GET failed: ${(err as Error).message}`);
    }
  }

  return failures;
}

/** HTML pages must carry the analytics snippet — the positive half of the check. */
async function checkPage(url: string): Promise<Failure[]> {
  const failures: Failure[] = [];
  const add = (problem: string) => failures.push({ url, problem });

  let res: Response;
  try {
    res = await fetch(url, { redirect: 'manual' });
  } catch (err) {
    add(`request failed (TLS or DNS?): ${(err as Error).message}`);
    return failures;
  }

  if (res.status !== 200) {
    add(`expected HTTP 200, got ${res.status}`);
    return failures;
  }
  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().startsWith('text/html')) {
    add(`content-type is "${contentType}", expected text/html`);
  }
  const body = await res.text();
  if (!body.includes('/_vercel/insights/script.js')) {
    add('page is missing the Web Analytics script — measurement silently dropped');
  }
  return failures;
}

async function main(): Promise<void> {
  const raw = process.argv[2];
  if (!raw) usage('Missing base URL.');

  let base: URL;
  try {
    base = new URL(raw.endsWith('/') ? raw : raw + '/');
  } catch {
    usage(`"${raw}" is not a valid URL.`);
  }
  if (base.protocol !== 'https:') {
    usage(
      `Base URL must be https. ".app" is HSTS-preloaded, so a plain-HTTP feed URL is unusable and browsers will not offer a click-through.`,
    );
  }

  const manifest = loadManifest();
  const paths = [...manifest.stages.map((s) => s.icsPath), manifest.all.icsPath];
  const pagePaths = ['/', `${manifest.festival.basePath}/`];

  process.stdout.write(`Smoke testing ${paths.length} feeds + ${pagePaths.length} pages against ${base.origin}\n\n`);

  const allFailures: Failure[] = [];
  for (const p of paths) {
    const url = new URL(p.replace(/^\//, ''), base).toString();
    const failures = await checkFeed(url);
    allFailures.push(...failures);
    process.stdout.write(`  ${failures.length === 0 ? 'ok  ' : 'FAIL'}  ${url}\n`);
    for (const f of failures) process.stdout.write(`          ${f.problem}\n`);
  }
  for (const p of pagePaths) {
    const url = new URL(p.replace(/^\//, ''), base).toString();
    const failures = await checkPage(url);
    allFailures.push(...failures);
    process.stdout.write(`  ${failures.length === 0 ? 'ok  ' : 'FAIL'}  ${url}\n`);
    for (const f of failures) process.stdout.write(`          ${f.problem}\n`);
  }

  process.stdout.write('\n');
  if (allFailures.length > 0) {
    process.stderr.write(
      `gate 8 FAILED: ${allFailures.length} problem(s) across ${paths.length} feeds + ${pagePaths.length} pages.\n`,
    );
    process.exitCode = 1;
    return;
  }
  process.stdout.write(
    `gate 8 passed: ${paths.length} feeds, all 200 / ${EXPECTED_CONTENT_TYPE} / ETag present / valid TLS, ` +
      `no script in any feed; ${pagePaths.length} pages carrying the analytics snippet.\n` +
      `Reminder: never leave a real subscription pointed at a preview URL — previews are ephemeral and will 404.\n`,
  );
}

void main();
