/**
 * Stage Times — static page rendering.
 *
 * Called by build.ts after the feeds are written. Emits:
 *   dist/index.html                       landing
 *   dist/<festival-key>/index.html        subscribe page
 *
 * Self-contained by rule: inlined CSS, no webfont, no script tag beyond the tiny
 * copy-to-clipboard handler and the Vercel Web Analytics snippet. The analytics
 * script is the one owner-approved exception (2026-08-08): it is same-origin
 * (`/_vercel/insights/script.js`, served by our own Vercel deployment), cookieless,
 * and aggregate-only — no third-party request, nothing stored about individuals.
 * This page is loaded on festival wifi at 2am and it has one job — get a thumb
 * from "I care about this stage" to "it's in my calendar".
 *
 * Visual system: .claude/skills/stage-times-design/. Structure is measured from Cash
 * App; color is the Fritz screenprint reference. Deviating from those numbers here
 * without updating the skill is how a design system rots.
 *
 * Deterministic: no clock read, no randomness. `lastUpdated` comes from committed state.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Manifest shape (structurally typed — build.ts owns the real type)
// ---------------------------------------------------------------------------

interface DaySpan {
  days: number;
  first: string;
  last: string;
  label: string;
}

interface StageEntry {
  id: string;
  name: string;
  description?: string;
  setCount: number;
  dayspan: DaySpan;
  icsPath: string;
}

export interface Manifest {
  festival: {
    name: string;
    slug: string;
    year: number;
    timezone: string;
    officialUrl: string;
    key: string;
    basePath: string;
  };
  stages: StageEntry[];
  all: { id: string; name: string; setCount: number; dayspan: DaySpan; icsPath: string };
  allSetCount: number;
  lastUpdated: string;
  verified: boolean;
}

/**
 * Production host. Feed URLs printed on the page are always absolute and always
 * point here — never at the preview origin. A preview URL is ephemeral; a
 * subscription pointed at one 404s the moment the deployment is superseded, and
 * there is no way to reach into someone's calendar to fix it.
 */
const PROD_ORIGIN = 'https://stagetimes.app';

// Per-stage colors, assigned by order and then frozen. See references/color.md.
//
// Note stage-1 is `--red-deep` (#C42408, 5.5:1 with cream) rather than the hero's
// `--red` (#EC300C, 4.0:1). Card text runs at 16px, which is not "large text" under
// WCAG, so the brighter vermillion fails AA there. The hero keeps #EC300C because
// 56px display type only needs 3:1. Same family, different job, deliberate.
const STAGE_COLORS = [
  '#C42408', // red
  '#045CAC', // blue
  '#1F7A4C', // green
  '#B5307A', // magenta
  '#A85100', // orange
  '#5B3FA8', // violet
  '#0C6B78', // teal
  '#8A1B2E', // oxblood
];

// ---------------------------------------------------------------------------
// Escaping
// ---------------------------------------------------------------------------

/** HTML text/attribute escape. Artist and stage names are festival-controlled data. */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** `20260808T000000Z` → `8 August 2026`. Deterministic, no locale dependence. */
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
function humanStamp(stamp: string): string {
  const m = /^(\d{4})(\d{2})(\d{2})T/.exec(stamp);
  if (!m) return stamp;
  const [, y, mo, d] = m;
  return `${Number(d)} ${MONTHS[Number(mo) - 1]} ${y}`;
}

// ---------------------------------------------------------------------------
// CSS — tokens from the design skill, verbatim
// ---------------------------------------------------------------------------

const CSS = `
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0}

:root{
  --paper:#FCF9F4; --paper-sunk:#F2EDE4; --paper-line:#E5DED1;
  --ink:#12181F; --ink-soft:#6B6459; --ink-faint:#A79E90;
  --red:#EC300C; --red-deep:#C42408;
  --blue:#045CAC; --yellow:#ECCC0C;

  --gap-1:8px; --gap-2:12px; --gap-3:16px; --gap-4:24px; --gap-5:32px; --gap-6:40px;
  --margin:16px; --pad-card:16px;
  --h-btn:52px; --r-btn:26px; --h-btn-sm:44px; --r-btn-sm:22px;
  --r-card:16px;
  --t-display:56px; --t-title:32px; --t-large:24px; --t-body:16px; --t-small:14px; --t-micro:12px;
  --measure:520px;
}

@media (prefers-color-scheme: dark){
  :root{
    --paper:#14120F; --paper-sunk:#211E19; --paper-line:#332E26;
    --ink:#F5F0E6; --ink-soft:#A79E90; --ink-faint:#6B6459;
    --red:#FF4A24; --red-deep:#FF6B4A;
  }
}

body{
  background:var(--paper); color:var(--ink);
  font-family:ui-sans-serif,-apple-system,"Helvetica Neue",Arial,sans-serif;
  font-size:var(--t-body); line-height:1.5;
  -webkit-font-smoothing:antialiased;
}

.wrap{max-width:var(--measure); margin:0 auto; padding:0 var(--margin)}

/* ── hero ─────────────────────────────────────────────────────────────── */
.hero{background:var(--red); color:#FCF9F4; padding:var(--gap-6) 0 var(--gap-5)}
.hero h1{
  margin:0; font-size:var(--t-display); line-height:1.02; font-weight:800;
  letter-spacing:-0.03em; text-transform:uppercase;
}
.hero p{margin:var(--gap-1) 0 0; font-size:20px; font-weight:600; opacity:.85}

/* ── type ─────────────────────────────────────────────────────────────── */
h2{font-size:var(--t-title); line-height:1.02; font-weight:800; letter-spacing:-0.025em; margin:0}
h3{font-size:var(--t-large); line-height:1.1; font-weight:800; letter-spacing:-0.02em; margin:0}
.sub{color:var(--ink-soft); font-size:var(--t-body); margin:var(--gap-1) 0 0}
.eyebrow{
  font-size:var(--t-micro); font-weight:700; letter-spacing:.07em;
  text-transform:uppercase; color:var(--ink-soft); margin:0 0 var(--gap-2)
}
.small{font-size:var(--t-small); color:var(--ink-soft)}

/* ── stage cards ──────────────────────────────────────────────────────── */
.stages{display:flex; flex-direction:column; gap:var(--gap-1); margin:var(--gap-4) 0 0; padding:0; list-style:none}
.card{border-radius:var(--r-card); padding:var(--pad-card); color:#FCF9F4}
.card h3{color:#FCF9F4}
.card .meta{
  font-size:var(--t-body); font-weight:600; opacity:.9; margin:2px 0 var(--gap-3);
}
.card .desc{font-size:var(--t-body); font-weight:500; opacity:.9; margin:0 0 var(--gap-3)}

.card--all{background:var(--paper-sunk); color:var(--ink); margin-top:var(--gap-5)}
.card--all h3{color:var(--ink)}
.card--all .meta{color:var(--ink-soft); opacity:1}
/* All Stages is deliberately demoted below the coloured cards, but it still has to
   look like a button. Ink-on-paper reads as pressable without competing for
   attention the way a colour fill would. */
.btn--ink{background:var(--ink); color:var(--paper)}

/* ── buttons ──────────────────────────────────────────────────────────── */
.btn{
  display:flex; align-items:center; justify-content:center;
  width:100%; height:var(--h-btn); border-radius:var(--r-btn);
  font-size:var(--t-body); font-weight:700; font-family:inherit;
  border:0; cursor:pointer; text-decoration:none;
  -webkit-tap-highlight-color:transparent;
}
.btn--on-color{background:#FCF9F4; color:#12181F}
.btn--tonal{background:var(--paper-sunk); color:var(--ink)}
.btn--primary{background:var(--red); color:#FCF9F4}
.btn--sm{height:var(--h-btn-sm); border-radius:var(--r-btn-sm)}
.btn:active{transform:scale(.99)}

/* Loading state. A webcal tap hands off to the OS and nothing visibly happens for a
   second or two — the button must acknowledge the press or people tap again. Text
   swap plus a gentle pulse; no spinner, because nothing ever goes inside a button
   except its label. pointer-events off so a double-tap can't fire twice. */
.btn.is-loading{pointer-events:none; animation:btn-pulse 1.1s ease-in-out infinite}
@keyframes btn-pulse{0%,100%{opacity:1}50%{opacity:.6}}

.btn-row{display:flex; gap:var(--gap-1); margin-top:var(--gap-1)}
.btn-row .btn{flex:1}
.btn--ghost-on-color{
  background:transparent; color:#FCF9F4;
  border:1px solid rgba(252,249,244,.45);
}
.card--all .btn--ghost-on-color{color:var(--ink); border-color:var(--paper-line)}

/* ── sections ─────────────────────────────────────────────────────────── */
section{margin-top:var(--gap-6)}
.prose p{margin:0 0 var(--gap-2); max-width:44ch}
.prose p:last-child{margin-bottom:0}

/* ── disclosure ───────────────────────────────────────────────────────── */
details{
  background:var(--paper-sunk); border-radius:var(--r-card);
  padding:var(--gap-3); margin-top:var(--gap-1);
}
summary{
  font-size:var(--t-body); font-weight:700; cursor:pointer; list-style:none;
  display:flex; justify-content:space-between; align-items:center;
}
summary::-webkit-details-marker{display:none}
summary::after{content:"+"; font-weight:700; color:var(--ink-soft)}
details[open] summary::after{content:"\\2212"}
details .body{margin-top:var(--gap-2); font-size:var(--t-small); color:var(--ink-soft)}
details .body ol{margin:0 0 var(--gap-2); padding-left:1.2em}

code.url{
  display:block; background:var(--paper); border:1px solid var(--paper-line);
  border-radius:8px; padding:10px 12px; margin-top:var(--gap-1);
  font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:13px;
  color:var(--ink); overflow-x:auto; white-space:nowrap;
}

/* ── banner ───────────────────────────────────────────────────────────── */
.banner{
  background:var(--yellow); color:#12181F; border-radius:var(--r-card);
  padding:var(--gap-3); margin-top:var(--gap-4); font-size:var(--t-small); font-weight:600;
}
.banner strong{display:block; font-size:var(--t-body); font-weight:800; margin-bottom:4px}

/* ── footer ───────────────────────────────────────────────────────────── */
footer{
  margin-top:var(--gap-6); padding:var(--gap-4) 0 var(--gap-6);
  border-top:1px solid var(--paper-line);
  font-size:var(--t-small); color:var(--ink-soft);
}
footer p{margin:0 0 6px}
footer a{color:inherit}
a{color:var(--red-deep)}

/* ── landing rows ─────────────────────────────────────────────────────── */
.fest-row{
  display:flex; align-items:center; justify-content:space-between; gap:var(--gap-3);
  background:var(--paper-sunk); border-radius:var(--r-card);
  padding:var(--gap-3) var(--pad-card); text-decoration:none; color:inherit;
  margin-top:var(--gap-4);
}
.fest-row .name{display:block; font-size:var(--t-large); font-weight:800; letter-spacing:-0.02em}
.fest-row .meta{display:block; font-size:var(--t-small); color:var(--ink-soft); margin-top:2px}
.fest-row .chev{font-size:var(--t-large); color:var(--ink-soft)}

@media (prefers-reduced-motion: reduce){
  *{transition:none !important; animation:none !important}
  .btn:active{transform:none}
}
@media (max-width:359px){
  :root{--t-display:44px; --t-title:28px}
}
`;

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

/**
 * Vercel Web Analytics, plain-HTML pattern (pages are static — no React, no
 * npm package). The stub queues `va()` calls made before the deferred script
 * loads; the script is served same-origin by Vercel, so the "no external
 * requests" rule still holds. Aggregate and cookieless by design. This snippet
 * belongs to HTML pages ONLY — never to .ics responses (tests/pages.test.ts
 * and the smoke test both pin that).
 */
const ANALYTICS_SNIPPET = `<script>window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };</script>
<script defer src="/_vercel/insights/script.js"></script>`;

function page(title: string, description: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="color-scheme" content="light dark">
<meta name="robots" content="index,follow">
<style>${CSS}</style>
${ANALYTICS_SNIPPET}
</head>
<body>
${body}
</body>
</html>
`;
}

// ---------------------------------------------------------------------------
// Subscribe page
// ---------------------------------------------------------------------------

function stageCard(stage: StageEntry, color: string, feedUrl: string, festivalKey: string): string {
  const webcal = feedUrl.replace(/^https:/, 'webcal:');
  const sets = `${stage.setCount} set${stage.setCount === 1 ? '' : 's'}`;
  return `<li class="card" style="background:${color}">
  <h3>${esc(stage.name)}</h3>
  <p class="meta">${sets} · ${esc(stage.dayspan.label)}</p>
  ${stage.description ? `<p class="desc">${esc(stage.description)}</p>` : ''}
  <a class="btn btn--on-color" href="${esc(webcal)}" data-festival="${esc(festivalKey)}" data-stage="${esc(stage.id)}">Subscribe</a>
  <div class="btn-row">
    <button class="btn btn--sm btn--ghost-on-color" data-copy="${esc(feedUrl)}">Copy link</button>
  </div>
</li>`;
}

export function renderSubscribePage(m: Manifest): string {
  const f = m.festival;
  const title = `${f.name} ${f.year} — set times by stage`;
  const desc = `Subscribe to ${f.name} ${f.year} set times, one calendar per stage.`;

  const cards = m.stages
    .map((s, i) => stageCard(s, STAGE_COLORS[i % STAGE_COLORS.length]!, `${PROD_ORIGIN}${s.icsPath}`, f.key))
    .join('\n');

  const allUrl = `${PROD_ORIGIN}${m.all.icsPath}`;
  const allWebcal = allUrl.replace(/^https:/, 'webcal:');

  const unverified = m.verified
    ? ''
    : `<div class="banner">
  <strong>Preview — set times not yet verified</strong>
  This schedule was transcribed from the official poster images and has not been checked by a
  human. Do not subscribe from this preview. See <code>source/TRANSCRIPTION.md</code> for the
  open questions.
</div>`;

  const body = `<header class="hero">
  <div class="wrap">
    <h1>Stage&nbsp;Times</h1>
    <p>Set times, by stage.</p>
  </div>
</header>

<main class="wrap">
  ${unverified}

  <section style="margin-top:var(--gap-5)">
    <h2>${esc(f.name)} ${f.year}</h2>
    <p class="sub">${esc(m.all.dayspan.label)} · ${m.allSetCount} sets · ${m.stages.length} stages</p>
  </section>

  <section>
    <p class="eyebrow">Pick your stages</p>
    <ul class="stages">
${cards}
      <li class="card card--all">
        <h3>${esc(m.all.name)}</h3>
        <p class="meta">${m.all.setCount} sets · every stage in one calendar</p>
        <a class="btn btn--ink" href="${esc(allWebcal)}" data-festival="${esc(f.key)}" data-stage="${esc(m.all.id)}">Subscribe</a>
        <div class="btn-row">
          <button class="btn btn--sm btn--ghost-on-color" data-copy="${esc(allUrl)}">Copy link</button>
        </div>
      </li>
    </ul>
    <p class="small" style="margin-top:var(--gap-3)">
      Two or three stages reads well in a day view. All ${m.stages.length} compresses into narrow
      unreadable columns — use the <a href="${esc(f.officialUrl)}">official schedule</a> for the
      full grid.
    </p>
  </section>

  <section>
    <p class="eyebrow">Not on iPhone?</p>

    <details>
      <summary>Google Calendar</summary>
      <div class="body">
        <p><strong>Desktop web only.</strong> Google Calendar cannot add a calendar by URL from
        the Android or iOS app at all — there is no menu for it. Use a computer:</p>
        <ol>
          <li>Open Google Calendar in a browser</li>
          <li>Settings → Add calendar → From URL</li>
          <li>Paste the stage's <code>https://</code> link and click Add calendar</li>
        </ol>
        <p>It then syncs to your phone. Google refreshes subscribed calendars on its own
        schedule — usually 12–24 hours, sometimes longer. We can't make it faster.</p>
      </div>
    </details>

    <details>
      <summary>Outlook</summary>
      <div class="body">
        <p>Web and desktop both work: Add calendar → Subscribe from web, then paste the
        <code>https://</code> link.</p>
      </div>
    </details>

    <details>
      <summary>iPhone, iPad, Mac</summary>
      <div class="body">
        <p>Tap Subscribe above — it opens Calendar and asks you to confirm. That's the whole
        flow. Apple honours our 12-hour refresh hint, so changes reach you within half a day.</p>
      </div>
    </details>
  </section>

  <footer>
    <p>Updated ${esc(humanStamp(m.lastUpdated))}. Times are ${esc(f.timezone.replace('_', ' '))} local.</p>
    <p>Unofficial. Not affiliated with ${esc(f.name)}.</p>
    <p>Source: <a href="${esc(f.officialUrl)}">the official schedule</a>.</p>
    <p>Found an error? <a href="https://github.com/jake-lunde/stage-times/issues">Open an issue</a>.</p>
  </footer>
</main>

<script>
document.addEventListener('click', function (e) {
  var copy = e.target.closest('[data-copy]');
  if (copy) {
    var url = copy.getAttribute('data-copy');
    var done = function () {
      var was = copy.textContent;
      copy.classList.add('is-loading');
      copy.textContent = 'Copied';
      setTimeout(function () {
        copy.textContent = was;
        copy.classList.remove('is-loading');
      }, 1600);
    };
    if (navigator.clipboard) { navigator.clipboard.writeText(url).then(done, function () {}); }
    return;
  }

  // Subscribe: the OS takes over and for a second or two nothing visible happens.
  // Acknowledge the tap, block re-fires, then restore — if Calendar opened, the
  // restore happens offscreen; if the platform silently ignored webcal:// (Android),
  // the button comes back and the "Not on iPhone?" section is the answer.
  var sub = e.target.closest('a[href^="webcal:"]');
  if (sub && !sub.classList.contains('is-loading')) {
    // The one custom analytics event: a subscribe tap. Aggregate and cookieless —
    // festival + stage only, nothing about the person. Best available "tried to
    // subscribe" signal; the calendar app takes over after this.
    if (window.va) {
      window.va('event', {
        name: 'subscribe',
        data: { festival: sub.getAttribute('data-festival'), stage: sub.getAttribute('data-stage') }
      });
    }
    var was = sub.textContent;
    sub.classList.add('is-loading');
    sub.setAttribute('aria-busy', 'true');
    sub.textContent = 'Opening Calendar\\u2026';
    setTimeout(function () {
      sub.textContent = was;
      sub.classList.remove('is-loading');
      sub.removeAttribute('aria-busy');
    }, 2500);
  }
});
</script>`;

  return page(title, desc, body);
}

// ---------------------------------------------------------------------------
// Landing page
// ---------------------------------------------------------------------------

export function renderLandingPage(m: Manifest): string {
  const f = m.festival;
  const body = `<header class="hero">
  <div class="wrap">
    <h1>Stage&nbsp;Times</h1>
    <p>Set times, by stage.</p>
  </div>
</header>

<main class="wrap">
  <a class="fest-row" href="${esc(f.basePath)}/">
    <span>
      <span class="name">${esc(f.name)} ${f.year}</span>
      <span class="meta">${esc(m.all.dayspan.label)} · ${m.stages.length} stages</span>
    </span>
    <span class="chev" aria-hidden="true">→</span>
  </a>

  <section class="prose">
    <p class="eyebrow">What this is</p>
    <p>Subscribe to one calendar per stage. The sets appear in the calendar app you already use,
    and you can colour or hide each stage independently.</p>
    <p>iCalendar has no field for "which calendar does this event belong to" — that's decided when
    you subscribe, one calendar per feed URL. So per-stage calendars can only exist as separate
    feeds. That's the whole product.</p>
  </section>

  <footer>
    <p>Unofficial. Not affiliated with any festival.</p>
    <p>Found an error? <a href="https://github.com/jake-lunde/stage-times/issues">Open an issue</a>.</p>
  </footer>
</main>`;

  return page('Stage Times — set times, by stage', 'One iCalendar subscription feed per festival stage.', body);
}

// ---------------------------------------------------------------------------
// Entry point called by build.ts
// ---------------------------------------------------------------------------

export function renderPages(manifest: Manifest, outDir: string): string[] {
  const written: string[] = [];

  const landing = join(outDir, 'index.html');
  writeFileSync(landing, renderLandingPage(manifest), 'utf8');
  written.push('index.html');

  const festDir = join(outDir, manifest.festival.key);
  mkdirSync(festDir, { recursive: true });
  const subscribe = join(festDir, 'index.html');
  writeFileSync(subscribe, renderSubscribePage(manifest), 'utf8');
  written.push(`${manifest.festival.key}/index.html`);

  return written;
}
