/**
 * Stage Times — static page rendering.
 *
 * Called by build.ts after the feeds are written. Emits:
 *   dist/index.html                       landing
 *   dist/<festival-key>/index.html        subscribe page
 *   dist/assets/**                        self-hosted fonts + festival art
 *
 * Self-contained by rule: inlined CSS, same-origin assets only. Fonts are
 * self-hosted woff2 (picked from Google Fonts, never served by it), art is a
 * committed image or inline SVG. The two scripts are the tiny copy/subscribe
 * handler and the Vercel Web Analytics snippet — the one owner-approved
 * exception (2026-08-08): same-origin (`/_vercel/insights/script.js`),
 * cookieless, aggregate-only. This page is loaded on festival wifi at 2am and
 * it has one job — get a thumb from "I care about this stage" to "it's in my
 * calendar".
 *
 * Visual system: .claude/skills/stage-times-design/. Structure is measured from
 * Cash App with owner-directed revisions (2026-08-09): Archivo/Fragment Mono,
 * media cards, the stage carousel, icon buttons, press-shrink. Deviating from
 * the skill here without updating it is how a design system rots.
 *
 * Deterministic: no clock read, no randomness. `lastUpdated` comes from
 * committed state; the procedural card art is seeded from festival/stage keys.
 */

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  headliners: string[];
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
// `--red` (#EC300C, 4.0:1). Card text runs at 13–17px, which is not "large text"
// under WCAG, so the brighter vermillion fails AA there. The hero keeps #EC300C
// because display type only needs 3:1. Same family, different job, deliberate.
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
// Escaping + formatting
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
// Procedural card art — deterministic screenprint capsules
// ---------------------------------------------------------------------------
//
// The design system drawing itself: vertical capsules (and the odd ball) in
// translucent cream and a deepened cut of the card color, flat fills only.
// Seeded by festival-key/stage-id so the build stays byte-reproducible —
// Math.random() would break the golden-file guarantee.

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Darken a #rrggbb toward black by `f` (0..1). Integer math — stable output. */
function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (shift: number) => Math.round(((n >> shift) & 0xff) * (1 - f));
  const to2 = (v: number) => v.toString(16).padStart(2, '0');
  return `#${to2(ch(16))}${to2(ch(8))}${to2(ch(0))}`;
}

/**
 * 400×240 capsule composition on a transparent ground (the card color shows
 * through). All coordinates are integers so the SVG string is byte-stable.
 */
function capsuleArt(seedKey: string, baseColor: string): string {
  const rand = mulberry32(fnv1a(seedKey));
  const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
  const fills = [
    'rgba(252,249,244,.22)',
    'rgba(252,249,244,.12)',
    shade(baseColor, 0.28),
    'rgba(252,249,244,.30)',
  ];

  const cols = int(7, 9);
  const pitch = Math.floor(400 / cols);
  const shapes: string[] = [];
  for (let i = 0; i < cols; i++) {
    const w = Math.floor(pitch * 0.68);
    const x = i * pitch + Math.floor((pitch - w) / 2);
    const fill = fills[int(0, fills.length - 1)]!;
    if (rand() < 0.22) {
      // a ball, hanging somewhere in the column
      const cy = int(40, 200);
      shapes.push(`<circle cx="${x + Math.floor(w / 2)}" cy="${cy}" r="${Math.floor(w / 2)}" fill="${fill}"/>`);
    } else {
      // a capsule; may bleed past either edge — the crop is part of the look
      const h = int(120, 300);
      const y = int(-60, 240 - Math.floor(h / 2));
      shapes.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${Math.floor(w / 2)}" fill="${fill}"/>`);
    }
  }
  return `<svg class="art-svg" viewBox="0 0 400 240" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${shapes.join('')}</svg>`;
}

// ---------------------------------------------------------------------------
// Icons — single glyphs for icon buttons; never mixed with a label
// ---------------------------------------------------------------------------

const ICON_BACK = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>`;
const ICON_LINK = `<svg class="ic-link" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.5 13.5a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4L12 5.6"/><path d="M13.5 10.5a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4L12 18.4"/></svg>`;
const ICON_CHECK = `<svg class="ic-check" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 12.5l5 5 10-11"/></svg>`;

// ---------------------------------------------------------------------------
// CSS — tokens from the design skill, verbatim
// ---------------------------------------------------------------------------

const CSS = `
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0}

@font-face{
  font-family:'Archivo';
  src:url('/assets/fonts/archivo-var-latin.woff2') format('woff2');
  font-weight:100 900; font-stretch:62% 125%; font-style:normal; font-display:swap;
}
@font-face{
  font-family:'Fragment Mono';
  src:url('/assets/fonts/fragment-mono-latin.woff2') format('woff2');
  font-weight:400; font-style:normal; font-display:swap;
}

:root{
  --paper:#FCF9F4; --paper-sunk:#F2EDE4; --paper-line:#E5DED1;
  --ink:#12181F; --ink-soft:#6B6459; --ink-faint:#A79E90;
  --red:#EC300C; --red-deep:#C42408;
  --blue:#045CAC; --yellow:#ECCC0C;

  --font-sans:'Archivo',ui-sans-serif,-apple-system,"Helvetica Neue",Arial,sans-serif;
  --font-mono:'Fragment Mono',ui-monospace,SFMono-Regular,Menlo,monospace;

  --gap-1:8px; --gap-2:12px; --gap-3:16px; --gap-4:24px; --gap-5:32px; --gap-6:40px;
  --margin:16px; --pad-card:16px;
  --h-btn:52px; --r-btn:26px; --h-btn-sm:44px; --r-btn-sm:22px; --h-icon:44px;
  --r-card:16px; --r-card-media:24px;
  --t-display:60px; --t-title:40px; --t-card:30px; --t-large:24px;
  --t-body:17px; --t-small:14px; --t-mono:13px; --t-micro:12px;
  --w-heading:630;
  --press:scale(.96); --t-press:120ms;
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
  font-family:var(--font-sans);
  font-size:var(--t-body); line-height:1.5;
  -webkit-font-smoothing:antialiased;
}

.wrap{max-width:var(--measure); margin:0 auto; padding:0 var(--margin)}

/* ── type ─────────────────────────────────────────────────────────────── */
/* Headings are big and light: the expanded width carries the weight. */
h1,h2,h3,.display{font-stretch:125%; font-weight:var(--w-heading); letter-spacing:-0.01em}
h2{font-size:var(--t-title); line-height:1.02; margin:0}
h3{font-size:var(--t-card); line-height:1.05; margin:0}
.mono{font-family:var(--font-mono); font-size:var(--t-mono)}
.mono-cap{
  font-family:var(--font-mono); font-size:var(--t-micro); letter-spacing:.07em;
  text-transform:uppercase;
}
.sub{color:var(--ink-soft); margin:var(--gap-2) 0 0}
.eyebrow{
  font-family:var(--font-mono); font-size:var(--t-micro); font-weight:400;
  letter-spacing:.07em; text-transform:uppercase; color:var(--ink-soft);
  margin:0 0 var(--gap-3);
}
.small{font-size:var(--t-mono); font-family:var(--font-mono); color:var(--ink-soft)}

/* ── hero (landing only) ──────────────────────────────────────────────── */
.hero{background:var(--red); color:#FCF9F4; padding:var(--gap-6) 0 var(--gap-5)}
/* The wordmark stacks, poster-style — expanded caps are too wide to run on one
   line on a phone, and the stack is the stronger screenprint gesture anyway. */
.hero h1{
  margin:0; font-size:clamp(44px, 15vw, var(--t-display)); line-height:.98;
  text-transform:uppercase; letter-spacing:-0.01em;
}
.hero p{margin:var(--gap-2) 0 0; font-size:20px; font-weight:500; opacity:.88}

/* ── press feedback: everything tappable shrinks under the thumb ──────── */
.btn,.icon-btn,.text-btn,.fest-card{transition:transform var(--t-press) ease}
.btn:active,.icon-btn:active,.text-btn:active,.fest-card:active{transform:var(--press)}

/* ── buttons ──────────────────────────────────────────────────────────── */
.btn{
  display:flex; align-items:center; justify-content:center;
  width:100%; height:var(--h-btn); border-radius:var(--r-btn);
  font-size:var(--t-body); font-weight:600; font-family:inherit;
  border:0; cursor:pointer; text-decoration:none;
  -webkit-tap-highlight-color:transparent;
}
.btn--on-color{background:#FCF9F4; color:#12181F}
.btn--primary{background:var(--red); color:#FCF9F4}
.btn--primary:active{background:var(--red-deep)}
.btn--ink{background:var(--ink); color:var(--paper)}
.btn--fit{width:auto; padding:0 var(--gap-4); flex:none}
.btn--sm{height:var(--h-btn-sm); border-radius:var(--r-btn-sm)}

/* Text button — Apple's "Buy now": a bare label, full touch target, no fill. */
.text-btn{
  display:inline-flex; align-items:center; min-height:var(--h-icon);
  font-size:var(--t-body); font-weight:600; color:var(--red-deep);
  text-decoration:none; cursor:pointer; -webkit-tap-highlight-color:transparent;
}

/* Icon button — 44pt circle, one glyph, aria-label mandatory. */
.icon-btn{
  display:inline-flex; align-items:center; justify-content:center; flex:none;
  width:var(--h-icon); height:var(--h-icon); border-radius:50%;
  background:var(--paper-sunk); color:var(--ink);
  border:0; cursor:pointer; text-decoration:none;
  -webkit-tap-highlight-color:transparent;
}
.icon-btn--on-color{background:rgba(252,249,244,.22); color:#FCF9F4}
.icon-btn .ic-check{display:none}
.icon-btn.copied .ic-link{display:none}
.icon-btn.copied .ic-check{display:block}

/* Loading state. A webcal tap hands off to the OS and nothing visibly happens for a
   second or two — the button must acknowledge the press or people tap again. Text
   swap plus a gentle pulse; a pill holds words and nothing else, so no spinner.
   pointer-events off so a double-tap can't fire twice. */
.btn.is-loading{pointer-events:none; animation:btn-pulse 1.1s ease-in-out infinite}
@keyframes btn-pulse{0%,100%{opacity:1}50%{opacity:.6}}

.actions{display:flex; gap:var(--gap-1); align-items:center; margin-top:var(--gap-3)}
.actions .btn{flex:1}

/* ── landing media card ───────────────────────────────────────────────── */
.fest-card{
  display:block; background:var(--paper-sunk); border-radius:var(--r-card-media);
  overflow:hidden; text-decoration:none; color:inherit; margin-top:var(--gap-4);
}
.fest-art{display:block; position:relative; aspect-ratio:1500/843; overflow:hidden}
.fest-art img{display:block; width:100%; height:100%; object-fit:cover}
.fest-art--gen{aspect-ratio:400/240}
.art-svg{position:absolute; inset:0; width:100%; height:100%}
.fest-body{display:block; padding:var(--gap-4) var(--pad-card) var(--pad-card)}
.fest-body .eyebrow{display:block}
.fest-name{display:block; font-size:34px; line-height:1.05; font-stretch:125%; font-weight:var(--w-heading); letter-spacing:-0.01em}
.fest-foot{
  display:flex; align-items:center; justify-content:space-between; gap:var(--gap-3);
  margin-top:var(--gap-4);
}
.fest-foot .mono-cap{color:var(--ink-soft)}

/* ── subscribe: top bar + lockup ──────────────────────────────────────── */
.topbar{padding:var(--gap-3) 0}
.lockup{
  font-stretch:125%; font-weight:var(--w-heading); font-size:14px;
  letter-spacing:.06em; text-transform:uppercase; color:var(--red-deep);
  margin:var(--gap-5) 0 var(--gap-1);
}
.title-meta{margin:var(--gap-2) 0 0; color:var(--ink-soft)}
.title-meta span{white-space:nowrap}

/* ── stage carousel ───────────────────────────────────────────────────── */
/* Pure CSS scroll-snap — the "scroll-jack" feel without hijacking anything.
   Cards are ~86% wide so the next stage peeks in; the peek is the affordance. */
.carousel{
  display:flex; gap:var(--gap-2);
  margin:0 calc(-1 * var(--margin)); padding:4px var(--margin);
  list-style:none;
  overflow-x:auto; scroll-snap-type:x mandatory; scroll-padding:0 var(--margin);
  -webkit-overflow-scrolling:touch;
  scrollbar-width:none;
}
.carousel::-webkit-scrollbar{display:none}
.stage-card{
  flex:0 0 86%; scroll-snap-align:center;
  border-radius:var(--r-card-media); overflow:hidden; color:#FCF9F4;
  display:flex; flex-direction:column;
}
.stage-art{position:relative; aspect-ratio:400/240}
.lineup{
  position:absolute; left:var(--pad-card); bottom:var(--gap-2); right:var(--pad-card);
  margin:0; font-size:18px; font-weight:600; line-height:1.3; color:#FCF9F4;
}
.lineup span{display:block}
.stage-body{padding:0 var(--pad-card) var(--pad-card)}
.stage-body h3{color:#FCF9F4}
.stage-body .meta{
  font-family:var(--font-mono); font-size:var(--t-mono); letter-spacing:.05em;
  text-transform:uppercase; color:rgba(252,249,244,.85); margin:6px 0 0;
}
.stage-body .desc{font-size:var(--t-small); color:rgba(252,249,244,.85); margin:var(--gap-2) 0 0}

/* ── all-stages card (deliberately demoted: sunk, ink, full width) ────── */
.card--all{
  background:var(--paper-sunk); color:var(--ink); border-radius:var(--r-card);
  padding:var(--pad-card); margin-top:var(--gap-4); list-style:none;
}
.card--all .meta{
  font-family:var(--font-mono); font-size:var(--t-mono); letter-spacing:.05em;
  text-transform:uppercase; color:var(--ink-soft); margin:6px 0 0;
}
.card--all .icon-btn{background:var(--paper); color:var(--ink)}

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
  font-size:var(--t-body); font-weight:600; cursor:pointer; list-style:none;
  display:flex; justify-content:space-between; align-items:center;
  min-height:32px;
}
summary::-webkit-details-marker{display:none}
summary::after{content:"+"; font-weight:600; color:var(--ink-soft)}
details[open] summary::after{content:"\\2212"}
details .body{margin-top:var(--gap-2); font-size:var(--t-small); color:var(--ink-soft)}
details .body ol{margin:0 0 var(--gap-2); padding-left:1.2em}

code.url{
  display:block; background:var(--paper); border:1px solid var(--paper-line);
  border-radius:8px; padding:10px 12px; margin-top:var(--gap-1);
  font-family:var(--font-mono); font-size:var(--t-mono);
  color:var(--ink); overflow-x:auto; white-space:nowrap;
}

/* ── banner ───────────────────────────────────────────────────────────── */
.banner{
  background:var(--yellow); color:#12181F; border-radius:var(--r-card);
  padding:var(--gap-3); margin-top:var(--gap-4); font-size:var(--t-small); font-weight:500;
}
.banner strong{display:block; font-size:var(--t-body); font-weight:600; margin-bottom:4px}

/* ── footer: the fine-detail voice is mono ────────────────────────────── */
footer{
  margin-top:var(--gap-6); padding:var(--gap-4) 0 var(--gap-6);
  border-top:1px solid var(--paper-line);
  font-family:var(--font-mono); font-size:var(--t-micro); line-height:1.6;
  color:var(--ink-soft);
}
footer p{margin:0 0 8px}
footer a{color:inherit}
a{color:var(--red-deep)}

@media (prefers-reduced-motion: reduce){
  *{transition:none !important; animation:none !important}
  .btn:active,.icon-btn:active,.text-btn:active,.fest-card:active{transform:none}
}
@media (max-width:359px){
  :root{--t-display:46px; --t-title:32px; --t-card:26px}
  .fest-name{font-size:28px}
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

const FONT_PRELOADS = `<link rel="preload" href="/assets/fonts/archivo-var-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/assets/fonts/fragment-mono-latin.woff2" as="font" type="font/woff2" crossorigin>`;

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
${FONT_PRELOADS}
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
  // The year lives in the page title; repeating it on every card just makes the
  // mono caption wrap.
  const span = stage.dayspan.label.replace(/ \d{4}$/, '');
  const lineup = stage.headliners
    .slice(0, 3)
    .map((a) => `<span>${esc(a)}</span>`)
    .join('');
  return `<li class="stage-card" style="background:${color}">
  <div class="stage-art">
    ${capsuleArt(`${festivalKey}/${stage.id}`, color)}
    <p class="lineup">${lineup}</p>
  </div>
  <div class="stage-body">
    <h3>${esc(stage.name)}</h3>
    <p class="meta">${sets} · ${esc(span)}</p>
    ${stage.description ? `<p class="desc">${esc(stage.description)}</p>` : ''}
    <div class="actions">
      <a class="btn btn--on-color" href="${esc(webcal)}" data-festival="${esc(festivalKey)}" data-stage="${esc(stage.id)}">Subscribe</a>
      <button class="icon-btn icon-btn--on-color" data-copy="${esc(feedUrl)}" aria-label="Copy calendar link">${ICON_LINK}${ICON_CHECK}</button>
    </div>
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

  const body = `<main class="wrap">
  <nav class="topbar">
    <a class="icon-btn" href="/" aria-label="Stage Times home">${ICON_BACK}</a>
  </nav>

  ${unverified}

  <header>
    <p class="lockup">Stage&nbsp;Times</p>
    <h2>${esc(f.name)} <span style="color:var(--ink-soft)">${f.year}</span></h2>
    <p class="title-meta mono-cap"><span>${esc(m.all.dayspan.label)}</span> · <span>${m.allSetCount} sets</span> · <span>${m.stages.length} stages</span></p>
  </header>

  <section>
    <p class="eyebrow">Pick your stages</p>
    <ul class="carousel">
${cards}
    </ul>
    <ul class="carousel-tail" style="margin:0;padding:0;list-style:none">
      <li class="card--all">
        <h3>${esc(m.all.name)}</h3>
        <p class="meta">${m.all.setCount} sets · every stage in one calendar</p>
        <div class="actions">
          <a class="btn btn--ink" href="${esc(allWebcal)}" data-festival="${esc(f.key)}" data-stage="${esc(m.all.id)}">Subscribe</a>
          <button class="icon-btn" data-copy="${esc(allUrl)}" aria-label="Copy calendar link">${ICON_LINK}${ICON_CHECK}</button>
        </div>
      </li>
    </ul>
    <p class="small" style="margin-top:var(--gap-3)">
      Two or three stages reads well in a day view. All ${m.stages.length} compresses into narrow
      unreadable columns — use the official grid for the full lineup.
    </p>
    <a class="text-btn" href="${esc(f.officialUrl)}">See the full lineup ↗</a>
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
      copy.classList.add('copied');
      copy.setAttribute('aria-label', 'Link copied');
      setTimeout(function () {
        copy.classList.remove('copied');
        copy.setAttribute('aria-label', 'Copy calendar link');
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

export interface LandingOptions {
  /** Site-absolute path to a committed festival image, e.g. `/assets/festivals/<key>.webp`. */
  heroImage?: string;
}

export function renderLandingPage(m: Manifest, opts: LandingOptions = {}): string {
  const f = m.festival;
  const art = opts.heroImage
    ? `<span class="fest-art"><img src="${esc(opts.heroImage)}" alt="" loading="lazy"></span>`
    : `<span class="fest-art fest-art--gen" style="background:var(--red-deep)">${capsuleArt(f.key, '#C42408')}</span>`;

  const body = `<header class="hero">
  <div class="wrap">
    <h1>Stage<br>Times</h1>
    <p>Set times, by stage.</p>
  </div>
</header>

<main class="wrap">
  <a class="fest-card" href="${esc(f.basePath)}/">
    ${art}
    <span class="fest-body">
      <span class="eyebrow">${esc(m.all.dayspan.label)}</span>
      <span class="fest-name">${esc(f.name)}</span>
      <span class="fest-foot">
        <span class="mono-cap">${m.allSetCount} sets · ${m.stages.length} stages</span>
        <span class="btn btn--primary btn--fit">See stages</span>
      </span>
    </span>
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

const ASSETS_SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'assets');
const IMAGE_EXTS = ['webp', 'jpg', 'jpeg', 'png', 'avif'];

export function renderPages(manifest: Manifest, outDir: string): string[] {
  const written: string[] = [];

  // Self-hosted assets: fonts always; festival art when committed. Copying
  // committed bytes keeps the build deterministic.
  if (existsSync(ASSETS_SRC)) {
    cpSync(ASSETS_SRC, join(outDir, 'assets'), { recursive: true });
    written.push('assets/');
  }

  const heroExt = IMAGE_EXTS.find((ext) =>
    existsSync(join(ASSETS_SRC, 'festivals', `${manifest.festival.key}.${ext}`)),
  );
  const heroImage = heroExt ? `/assets/festivals/${manifest.festival.key}.${heroExt}` : undefined;

  const landing = join(outDir, 'index.html');
  writeFileSync(landing, renderLandingPage(manifest, { heroImage }), 'utf8');
  written.push('index.html');

  const festDir = join(outDir, manifest.festival.key);
  mkdirSync(festDir, { recursive: true });
  const subscribe = join(festDir, 'index.html');
  writeFileSync(subscribe, renderSubscribePage(manifest), 'utf8');
  written.push(`${manifest.festival.key}/index.html`);

  return written;
}
