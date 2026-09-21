/**
 * Validation gate 8 — post-deploy smoke test.
 *
 * A script, not a unit test: it needs a live deployment. Run it against the
 * preview URL on every PR and against the apex after a production deploy.
 *
 *   npm run smoke -- https://stagetimes.app
 *   npm run smoke -- https://stage-times-git-branch-you.vercel.app
 *
 * For every feed of every edition listed in dist/feeds.json — owner editions at
 * the root, fan editions under /fan/ — it asserts:
 *   - HTTP 200
 *   - content-type: text/calendar; charset=utf-8   (exactly — no extension sniffing)
 *   - an ETag is present, so well-behaved clients get 304s and polling stays cheap
 *   - valid TLS (fetch refuses an untrusted certificate; .app is HSTS-preloaded so
 *     there is no plain-HTTP fallback for a browser either)
 *   - the body actually begins BEGIN:VCALENDAR
 *   - the body carries no script tag — the analytics snippet is for HTML pages only
 *
 * For a BLOCKED edition it additionally asserts that each feed is a valid,
 * empty calendar: no VEVENT at all, and the calendar name (X-WR-CALNAME) still
 * present — a subscriber's calendar goes blank, never 404.
 *
 * And for the HTML pages (landing + one per edition) it asserts the inverse: the
 * Vercel Web Analytics script IS present, so a refactor can't silently drop
 * measurement. A blocked edition's page must be the removed page — no calendar
 * links on it. The landing page must carry exactly one card per listed edition,
 * each linking to that edition's page in its namespace, and none for anything
 * unlisted or blocked.
 * The upload page (/upload/) must carry all of its screens.
 *
 * A preview behind Vercel Deployment Protection can be smoke-tested by setting
 * VERCEL_AUTOMATION_BYPASS_SECRET: every request then carries the bypass header.
 *
 * The body checks exist because of Vercel Deployment Protection: a protected
 * preview returns 200 with an HTML login page, which a header-only check happily
 * passes and a calendar client chokes on.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Manifest, SiteManifest } from '../src/build.js';
import { listedEditions, type Manifest as PageManifest } from '../src/pages.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EXPECTED_CONTENT_TYPE = 'text/calendar; charset=utf-8';

/** Vercel's protection bypass, when a preview is behind it. Sent on every request; harmless elsewhere. */
const BYPASS = process.env['VERCEL_AUTOMATION_BYPASS_SECRET'];
const HEADERS: Record<string, string> = BYPASS ? { 'x-vercel-protection-bypass': BYPASS } : {};

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

function loadManifest(): SiteManifest {
  const path = join(REPO_ROOT, 'dist', 'feeds.json');
  if (!existsSync(path)) usage(`No dist/feeds.json — run \`npm run build\` first so the smoke test knows what to poll.`);
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as SiteManifest;
  if (!Array.isArray(parsed.editions)) usage(`dist/feeds.json has no \`editions\` list — rebuild with the current build.`);
  return parsed;
}

async function checkFeed(url: string, blocked: boolean): Promise<Failure[]> {
  const failures: Failure[] = [];
  const add = (problem: string) => failures.push({ url, problem });

  let res: Response;
  try {
    // HEAD mirrors `curl -I`. Any TLS problem throws here rather than returning.
    res = await fetch(url, { method: 'HEAD', redirect: 'manual', headers: HEADERS });
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
      const body = await (await fetch(url, { redirect: 'manual', headers: HEADERS })).text();
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
      } else if (blocked) {
        // A blocked edition's feed is a valid calendar with nothing in it.
        if (body.includes('BEGIN:VEVENT')) add('blocked edition still serves events — the block did not deploy');
        if (!/^X-WR-CALNAME:.+/m.test(body)) add('blocked feed lost its calendar name (X-WR-CALNAME)');
        if (!body.includes('BEGIN:VTIMEZONE')) add('blocked feed lost its VTIMEZONE — not a valid calendar for every client');
      }
    } catch (err) {
      add(`GET failed: ${(err as Error).message}`);
    }
  }

  return failures;
}

interface PageCheck {
  blocked?: boolean;
  /** For the landing page: the editions whose cards must be there, and only those. */
  listed?: PageManifest[];
  /** For /upload/: every screen of the flow must be in the markup. */
  upload?: boolean;
}

/** HTML pages must carry the analytics snippet — the positive half of the check. */
async function checkPage(url: string, { blocked = false, listed, upload = false }: PageCheck = {}): Promise<Failure[]> {
  const failures: Failure[] = [];
  const add = (problem: string) => failures.push({ url, problem });

  let res: Response;
  try {
    res = await fetch(url, { redirect: 'manual', headers: HEADERS });
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
  if (blocked) {
    if (body.includes('webcal:')) add('blocked edition still serves the subscribe page — the removed page did not deploy');
    if (!body.includes('Taken down')) add('blocked edition page does not say it was taken down');
  }
  if (listed) {
    const cards = (body.match(/class="shelf-card"/g) ?? []).length;
    if (cards !== listed.length) add(`homepage carries ${cards} card(s), expected one per listed edition (${listed.length})`);
    for (const m of listed) {
      if (!body.includes(`href="${m.festival.basePath}/"`)) add(`homepage has no card linking to ${m.festival.basePath}/`);
    }
  }
  if (upload) {
    for (const screen of ['details', 'upload', 'review', 'publishing', 'success']) {
      if (!body.includes(`data-screen="${screen}"`)) add(`upload page is missing its "${screen}" screen`);
    }
    if (!body.includes('/api/upload') || !body.includes('/api/confirm')) add('upload page does not talk to both adapters');
  }
  return failures;
}

function feedPaths(m: Manifest): string[] {
  return [...m.stages.map((s) => s.icsPath), m.all.icsPath];
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

  const site = loadManifest();
  const feeds = site.editions.flatMap((m) => feedPaths(m).map((p) => ({ path: p, blocked: m.blocked })));
  // The same rule the homepage renders from, so the check cannot drift from the page.
  const listed = listedEditions(site);
  const pages: { path: string; check: PageCheck }[] = [
    { path: '/', check: { listed } },
    ...site.editions.map((m) => ({ path: `${m.festival.basePath}/`, check: { blocked: m.blocked } })),
    { path: '/upload/', check: { upload: true } },
  ];
  const blockedCount = site.editions.filter((m) => m.blocked).length;

  process.stdout.write(
    `Smoke testing ${feeds.length} feeds + ${pages.length} pages across ${site.editions.length} edition(s)` +
      `${blockedCount ? ` (${blockedCount} blocked)` : ''} against ${base.origin}\n\n`,
  );

  const allFailures: Failure[] = [];
  for (const f of feeds) {
    const url = new URL(f.path.replace(/^\//, ''), base).toString();
    const failures = await checkFeed(url, f.blocked);
    allFailures.push(...failures);
    process.stdout.write(`  ${failures.length === 0 ? 'ok  ' : 'FAIL'}  ${url}${f.blocked ? '  (blocked: must be empty)' : ''}\n`);
    for (const x of failures) process.stdout.write(`          ${x.problem}\n`);
  }
  for (const p of pages) {
    const url = new URL(p.path.replace(/^\//, ''), base).toString();
    const failures = await checkPage(url, p.check);
    allFailures.push(...failures);
    const note = p.check.blocked ? '  (blocked: removed page)' : p.check.listed ? `  (${p.check.listed.length} listed card(s))` : p.check.upload ? '  (the upload flow)' : '';
    process.stdout.write(`  ${failures.length === 0 ? 'ok  ' : 'FAIL'}  ${url}${note}\n`);
    for (const x of failures) process.stdout.write(`          ${x.problem}\n`);
  }

  process.stdout.write('\n');
  if (allFailures.length > 0) {
    process.stderr.write(
      `gate 8 FAILED: ${allFailures.length} problem(s) across ${feeds.length} feeds + ${pages.length} pages.\n`,
    );
    process.exitCode = 1;
    return;
  }
  process.stdout.write(
    `gate 8 passed: ${feeds.length} feeds, all 200 / ${EXPECTED_CONTENT_TYPE} / ETag present / valid TLS, ` +
      `no script in any feed${blockedCount ? `, ${blockedCount} blocked edition(s) serving valid empty calendars` : ''}; ` +
      `${pages.length} pages carrying the analytics snippet.\n` +
      `Reminder: never leave a real subscription pointed at a preview URL — previews are ephemeral and will 404.\n`,
  );
}

void main();
