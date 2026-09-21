/**
 * Stage Times — static page rendering.
 *
 * Called by build.ts after the feeds are written. Emits:
 *   dist/index.html                       landing — the directory of listed editions
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
 * the stage carousel, icon buttons, press-shrink; the landing page is the shelf
 * archetype measured off the Apple Store (references/store-density.md, ticket
 * 06). Deviating from the skill here without updating it is how a design system
 * rots.
 *
 * Deterministic: no clock read, no randomness. `lastUpdated` comes from
 * committed state; the card art is drawn from the sets, and the no-image
 * fallback is seeded from the festival key.
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
  sets: { artist: string; start: string; end: string }[];
  icsPath: string;
}

export interface Manifest {
  festival: {
    name: string;
    slug: string;
    year: number;
    timezone: string;
    officialUrl: string;
    /** Display only, for the directory card's eyebrow. */
    city?: string;
    key: string;
    basePath: string;
  };
  /** `owner` editions sit at the root, `fan` editions under `/fan/` (ADR-0001). */
  namespace: 'owner' | 'fan';
  /** Approved for the homepage by the owner. Never true while blocked. */
  listed: boolean;
  /** Taken down: feeds serve empty, and the page is the removed page, not the subscribe page. */
  blocked: boolean;
  stages: StageEntry[];
  all: { id: string; name: string; setCount: number; dayspan: DaySpan; icsPath: string };
  allSetCount: number;
  lastUpdated: string;
  verified: boolean;
}

/** `dist/feeds.json` — every edition the build produced, in edition-path order. */
export interface SiteManifest {
  editions: Manifest[];
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
// Seeding — FNV-1a and mulberry32, shared with the explorer
// ---------------------------------------------------------------------------
//
// The one place a card is not drawn from the sets is the directory card's
// no-image fallback, and it is seeded by festival key so the build stays
// byte-reproducible — Math.random() would break the golden-file guarantee.

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

// ---------------------------------------------------------------------------
// Stage card art — the beads (owner pick, 2026-09-21)
// ---------------------------------------------------------------------------
//
// A ring per festival day, evenly spaced from the center to the card edge; a
// bead per set at its clock position (2 PM at twelve, clockwise through the
// night); bead size is set length; the ring is solid across the hours the
// stage runs that day. Each day's closer is a four-point star. The headliner
// names cycle in the center as a poster block (the night and the start time
// above the name), and the closer's star lights in the stage color while its
// name is up. Rings drift at their own speeds; stars counter-rotate to stay
// upright. All of it is CSS animation on static SVG — the build stays
// byte-reproducible and nothing here reads a clock. Explorer and rationale:
// _ref/stage-art-explorer/.
//
// Nothing random: every coordinate comes from the sets. Integer coordinates.

const ART_W = 400;
const ART_H = 240;
const ART_CX = 200;
const ART_CY = 120;
/** The dial runs 2 PM to 2 AM; a night runs until 6 AM, so a set that starts before 6 AM belongs to the night before. */
const DAY_T0 = 14 * 60;
const DAY_T1 = 26 * 60;
const NIGHT_ENDS = 6 * 60;
const RING_INNER = 86;
const RING_OUTER = 176;
const RING_SPIN_S = [300, 220, 380];
const NAME_HOLD_S = 4.5;
const WEEKDAYS_FULL = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];

/** Mix a #rrggbb toward another by `t` (0..1). Integer math — stable output. */
function mix(a: string, b: string, t: number): string {
  const A = parseInt(a.slice(1), 16);
  const B = parseInt(b.slice(1), 16);
  const ch = (shift: number) => Math.round(((A >> shift) & 0xff) * (1 - t) + ((B >> shift) & 0xff) * t);
  const to2 = (v: number) => v.toString(16).padStart(2, '0');
  return `#${to2(ch(16))}${to2(ch(8))}${to2(ch(0))}`;
}

/** The light ground behind a stage's art: the stage color mixed 45% toward cream. */
export function artGround(color: string): string {
  return mix(color, '#FCF9F4', 0.45);
}

/** Minutes since midnight → `10:40 PM`, wrapping past 24h. */
function clockLabel(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  const ap = h >= 12 ? 'PM' : 'AM';
  return `${((h + 11) % 12) + 1}${m ? ':' + String(m).padStart(2, '0') : ''} ${ap}`;
}

/** `YYYY-MM-DD…` → year, month, day. */
function ymd(iso: string): [number, number, number] {
  return iso.slice(0, 10).split('-').map(Number) as [number, number, number];
}

function weekdayOf(iso: string): string {
  const [y, mo, d] = ymd(iso);
  return WEEKDAYS_FULL[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()]!;
}

/** Consecutive dates from first to last, inclusive. */
export function dateRange(first: string, last: string): string[] {
  const out: string[] = [];
  const [y, m, d] = ymd(first);
  const cur = new Date(Date.UTC(y, m - 1, d));
  for (let i = 0; i < 60; i++) {
    const iso = cur.toISOString().slice(0, 10);
    out.push(iso);
    if (iso >= last.slice(0, 10)) break;
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

function sparkle(x: number, y: number, k: number, fill: string, extra = ''): string {
  return `<path d="M${x} ${y - k}Q${x} ${y} ${x + k} ${y}Q${x} ${y} ${x} ${y + k}Q${x} ${y} ${x - k} ${y}Q${x} ${y} ${x} ${y - k}Z" fill="${fill}"${extra}/>`;
}

interface ArtSet {
  artist: string;
  day: number;
  startMin: number;
  endMin: number;
  len: number;
  /** 0..1 around the dial. */
  x: number;
}

function shapeSets(sets: StageEntry['sets'], dayDates: string[]): ArtSet[] {
  const hhmm = (t: string) => {
    const [h, m] = t.split(':').map(Number) as [number, number];
    return h * 60 + m;
  };
  return sets
    .map((s) => {
      const [sd, st] = s.start.split('T') as [string, string];
      const [ed, et] = s.end.split('T') as [string, string];
      let day = dayDates.indexOf(sd);
      let startMin = hhmm(st);
      let endMin = hhmm(et) + (ed > sd ? 1440 : 0);
      if (startMin < NIGHT_ENDS) {
        day -= 1;
        startMin += 1440;
        endMin += 1440;
      }
      // Past 2 AM the dial is full; a later start sits at twelve rather than wrapping.
      const x = Math.min(1, Math.max(0, (startMin - DAY_T0) / (DAY_T1 - DAY_T0)));
      return { artist: s.artist, day, startMin, endMin, len: endMin - startMin, x };
    })
    .filter((s) => s.day >= 0)
    .sort((a, b) => a.day - b.day || a.startMin - b.startMin);
}

/** Display size that fits a name across the art: expanded Archivo caps run about 0.78em per character. */
function fitSize(name: string, max: number, min = 22, width = 340): number {
  return Math.max(min, Math.min(max, Math.floor(width / (name.length * 0.78))));
}

const popStyle = (i: number, n: number) =>
  `animation:pop${n} ${n * NAME_HOLD_S}s linear infinite;animation-delay:${(i * NAME_HOLD_S).toFixed(1)}s`;

export function beadsArt(stage: StageEntry, color: string, dayDates: string[]): string {
  const cream = '#FCF9F4';
  const ink = '#12181F';
  const nd = Math.max(1, dayDates.length);
  const sets = shapeSets(stage.sets, dayDates);
  const rOf = (d: number) => Math.round(nd === 1 ? RING_OUTER : RING_INNER + (d * (RING_OUTER - RING_INNER)) / (nd - 1));
  const angOf = (x: number) => -Math.PI / 2 + x * 2 * Math.PI;
  const px = (a: number, r: number) => `${Math.round(ART_CX + Math.cos(a) * r)} ${Math.round(ART_CY + Math.sin(a) * r)}`;

  // The starred sets: the stage's billed headliners (one per night, in night order),
  // or the last set of each night when none are billed.
  const closers = new Map<number, ArtSet>();
  for (const s of sets) closers.set(s.day, s);
  const billed = stage.headliners.map((h) => sets.find((s) => s.artist === h)).filter((s): s is ArtSet => !!s);
  const closerList = billed.length > 0 ? billed : [...closers.values()];
  const n = closerList.length;

  const rings: string[] = [];
  for (let d = 0; d < nd; d++) {
    const r = rOf(d);
    const ds = sets.filter((s) => s.day === d);
    const spin = RING_SPIN_S[d % 3]! * (d >= 3 ? 1.3 : 1);
    const parts = [`<circle cx="${ART_CX}" cy="${ART_CY}" r="${r}" fill="none" stroke="${cream}" stroke-opacity=".12" stroke-width="1"/>`];
    if (ds.length) {
      const a0 = angOf(Math.min(...ds.map((s) => s.x)));
      const a1 = angOf(Math.min(1, Math.max(...ds.map((s) => (s.endMin - DAY_T0) / (DAY_T1 - DAY_T0)))));
      const large = a1 - a0 > Math.PI ? 1 : 0;
      parts.push(
        `<path d="M${px(a0, r)}A${r} ${r} 0 ${large} 1 ${px(a1, r)}" fill="none" stroke="${cream}" stroke-opacity=".45" stroke-width="2" stroke-linecap="round"/>`,
      );
    }
    for (const s of ds) {
      const a = angOf(s.x);
      const x = Math.round(ART_CX + Math.cos(a) * r);
      const y = Math.round(ART_CY + Math.sin(a) * r);
      const rad = Math.round((4 + (s.len / 60) * 5) * 1.02);
      const li = closerList.indexOf(s);
      if (li >= 0) {
        const k = Math.round(rad * 2.4);
        parts.push(
          `<g class="unrot" style="transform-origin:${x}px ${y}px;--spin:${spin}s">` +
            sparkle(x, y, k, cream, ' fill-opacity=".95"') +
            `<g class="pop${li === 0 ? ' first' : ''}" style="${popStyle(li, n)}">${sparkle(x, y, Math.round(k * 1.8), color)}</g>` +
            `</g>`,
        );
      } else {
        parts.push(`<circle cx="${x}" cy="${y}" r="${rad}" fill="${cream}" fill-opacity=".95"/>`);
      }
    }
    rings.push(`<g class="rot" style="--spin:${spin}s">${parts.join('')}</g>`);
  }

  const names = closerList
    .map((s, i) => {
      const fs = fitSize(s.artist, 48);
      const eyebrow = `${weekdayOf(dayDates[s.day]!)} · ${clockLabel(s.startMin)}`;
      return (
        `<g class="pop${i === 0 ? ' first' : ''}" style="${popStyle(i, n)}">` +
        `<text class="eb" x="${ART_CX}" y="${ART_CY - Math.round(fs * 0.5) - 10}" text-anchor="middle" fill="${ink}" fill-opacity=".85">${esc(eyebrow)}</text>` +
        `<text class="disp" x="${ART_CX}" y="${ART_CY + Math.round(fs * 0.42)}" font-size="${fs}" text-anchor="middle" fill="${ink}">${esc(s.artist)}</text>` +
        `</g>`
      );
    })
    .join('');

  const label = closerList.length ? `Headliners: ${closerList.map((s) => s.artist).join(', ')}` : `${stage.name} art`;
  return (
    `<svg class="art-svg" viewBox="0 0 ${ART_W} ${ART_H}" preserveAspectRatio="xMidYMid slice" role="img" aria-label="${esc(label)}">` +
    rings.join('') +
    (names ? `<g class="lbl">${names}</g>` : '') +
    `</svg>`
  );
}

// ---------------------------------------------------------------------------
// Directory card art — the Facets core (owner ruling, 2026-09-20)
// ---------------------------------------------------------------------------
//
// What a directory card draws when the festival has no committed image: the
// disco ball, the festival's own globe motif, from the stage art explorer
// (_ref/stage-art-explorer/, "Facets"). A cream disc on the light ground, with
// the ground cutting the facets back through it: five chords and the meridian
// ellipses, clipped to the disc and tilted by a seeded angle. The only seeded
// value is the tilt; everything else is the geometry. Integer coordinates.

const FACETS_R = 84;

/**
 * The Facets core, seeded by festival key, on the light ground of `color`.
 * `domId` names the clip path in the page: an owner and a fan edition of the
 * same festival-year share a key but must not share an id, so the caller
 * passes something unique to the edition (its path).
 */
export function facetsArt(key: string, color: string, domId: string = key): string {
  const cream = '#FCF9F4';
  const ground = artGround(color);
  const rand = mulberry32(fnv1a(key));
  const id = `f${fnv1a(domId).toString(36)}`;
  const tilt = Math.round((rand() - 0.5) * 40);
  const cx = ART_CX;
  const cy = ART_CY;
  const r = FACETS_R;
  const lines: string[] = [];
  for (let i = 1; i < 6; i++) {
    const y = cy - r + i * ((r * 2) / 6);
    const w = Math.sqrt(Math.max(0, r * r - (y - cy) * (y - cy)));
    lines.push(`<line x1="${Math.round(cx - w)}" y1="${Math.round(y)}" x2="${Math.round(cx + w)}" y2="${Math.round(y)}"/>`);
  }
  for (let i = 1; i < 3; i++) {
    const rx = Math.round(r * Math.abs(Math.cos((i * Math.PI) / 6)));
    lines.push(`<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${r}"/>`);
  }
  return (
    `<svg class="art-svg art-facets" viewBox="0 0 ${ART_W} ${ART_H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true">` +
    `<defs><clipPath id="${id}"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath></defs>` +
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${cream}"/>` +
    `<g clip-path="url(#${id})" transform="rotate(${tilt} ${cx} ${cy})" fill="none" stroke="${ground}" stroke-width="3">${lines.join('')}</g>` +
    `</svg>`
  );
}

/** One name shows for its slice of the cycle; up to eight closers share one cycle. */
function popKeyframes(): string {
  let css = '';
  for (let n = 1; n <= 8; n++) {
    const k = 100 / n;
    css += `@keyframes pop${n}{0%{opacity:0}${(k * 0.08).toFixed(2)}%{opacity:1}${(k * 0.82).toFixed(2)}%{opacity:1}${(k * 0.92).toFixed(2)}%{opacity:0}100%{opacity:0}}`;
  }
  return css;
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
/* overflow-x:clip — the shelf runs to the viewport's right edge by 100vw, which on a
   classic-scrollbar desktop is a few px past the layout width; clip keeps the page
   from growing a horizontal scrollbar for it (no scroll container, unlike hidden). */
html{-webkit-text-size-adjust:100%; overflow-x:clip}
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
  /* Every card and tile is one radius (owner ruling 2026-09-20). */
  --r-card:18px;
  /* The shelf — references/store-density.md. Phone values; from 735px up, below. */
  --pad-shelf:28px; --gap-shelf:20px; --gap-section:clamp(48px, 6vw, 64px);
  --h-shelf-card:450px; --w-shelf-card:calc(100vw - 2 * var(--margin) - 24px);
  --t-shelf:24px;  /* the shelf header and the card title: one size (Store: 28 / 28) */
  --t-display:60px; --t-title:40px; --t-card:30px; --t-large:24px;
  --t-body:17px; --t-small:14px; --t-mono:13px; --t-micro:12px;
  --w-heading:630;
  --press:scale(.96); --t-press:120ms;
  --measure:520px;
}
@media (min-width:735px){
  :root{--h-shelf-card:500px; --w-shelf-card:400px; --t-shelf:28px}
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
.btn,.icon-btn,.text-btn,.shelf-card{transition:transform var(--t-press) ease}
.btn:active,.icon-btn:active,.text-btn:active,.shelf-card:active{transform:var(--press)}

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
/* The Android dead-tap recovery line: hidden until the button restores itself,
   17pt/600 so it clears the on-color contrast rule inside a stage card. */
.recover{margin:var(--gap-2) 0 0; font-size:var(--t-body); font-weight:600; line-height:1.3}
.recover a{color:inherit}

/* ── landing shelf: the directory (ticket 06; references/store-density.md) ── */
/* One frame: the section header, the first card, and the prose below all share
   the measure's left edge. The shelf starts there and runs to the viewport's
   right edge, so on a phone one card owns the screen with a 24px peek and a
   desktop shows two and a bit. Pure CSS scroll-snap, no scrollbar. */
.shelf-section{margin-top:var(--gap-6)}
.shelf-head{
  margin:0 0 var(--gap-4); font-size:var(--t-shelf); line-height:1.15;
  font-stretch:125%; font-weight:600; letter-spacing:-0.01em;
}
.shelf-head .lead{color:var(--ink)}
.shelf-head .tail{color:var(--ink-soft)}
.shelf{
  display:flex; gap:var(--gap-shelf); list-style:none;
  margin:0 0 0 calc(-1 * var(--margin)); width:calc(50% + 50vw + var(--margin)); max-width:980px;
  padding:4px var(--margin);
  overflow-x:auto; scroll-snap-type:x mandatory; scroll-padding:0 var(--margin);
  -webkit-overflow-scrolling:touch;
  scrollbar-width:none;
}
.shelf::-webkit-scrollbar{display:none}
.shelf>li{flex:none; scroll-snap-align:start}
.shelf-card{
  display:flex; flex-direction:column; width:var(--w-shelf-card); height:var(--h-shelf-card);
  background:var(--paper-sunk); border-radius:var(--r-card);
  overflow:hidden; text-decoration:none; color:inherit;
}
.shelf-text{display:block; flex:none; padding:var(--pad-shelf) var(--pad-shelf) var(--gap-4)}
.shelf-text .eyebrow{display:block; margin:0 0 var(--gap-1)}
.eyebrow--fan{color:var(--red-deep)}
.shelf-title{
  display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:2; overflow:hidden;
  font-size:var(--t-shelf); line-height:1.1;
  font-stretch:125%; font-weight:600; letter-spacing:-0.01em;
}
.shelf-lead{display:block; margin-top:10px; font-size:var(--t-body); font-weight:600; line-height:1.3}
.shelf-meta{display:block; margin-top:6px; font-size:var(--t-small); line-height:1.3; color:var(--ink-soft)}
/* Art fills the rest of the fixed-height card, edge to edge, no padding. */
.shelf-art{display:block; flex:1; position:relative; min-height:0; overflow:hidden}
.shelf-art img{position:absolute; inset:0; width:100%; height:100%; object-fit:cover}
.art-svg{position:absolute; inset:0; width:100%; height:100%}
.shelf-section+section{margin-top:var(--gap-section)}

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
  display:flex; gap:var(--gap-shelf);
  margin:0 calc(-1 * var(--margin)); padding:4px var(--margin);
  list-style:none;
  overflow-x:auto; scroll-snap-type:x mandatory; scroll-padding:0 var(--margin);
  -webkit-overflow-scrolling:touch;
  scrollbar-width:none;
}
.carousel::-webkit-scrollbar{display:none}
.stage-card{
  flex:0 0 86%; scroll-snap-align:center;
  border-radius:var(--r-card); overflow:hidden; color:#FCF9F4;
  display:flex; flex-direction:column;
}
.stage-art{position:relative; aspect-ratio:400/240}
/* The beads: rings drift at their own speed, stars counter-rotate to stay
   upright, the headliner names cycle in the center. See beadsArt(). */
.rot{transform-origin:200px 120px; animation:spin var(--spin,240s) linear infinite}
.unrot{animation:spin var(--spin,240s) linear infinite reverse}
@keyframes spin{to{transform:rotate(360deg)}}
.lbl{font-family:var(--font-sans); font-weight:600}
.lbl .disp{font-stretch:125%; font-weight:var(--w-heading); letter-spacing:-0.01em}
.lbl .eb{font-family:var(--font-mono); font-weight:400; font-size:11px; letter-spacing:.07em; text-transform:uppercase}
.pop{opacity:0}
${popKeyframes()}
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
  .btn:active,.icon-btn:active,.text-btn:active,.shelf-card:active{transform:none}
  .pop.first{opacity:1}
}
@media (max-width:359px){
  :root{--t-display:46px; --t-title:32px; --t-card:26px; --t-shelf:22px}
}

/* ── removed page (a blocked edition): one heading, two lines, one pill ── */
.removed h3{margin-bottom:var(--gap-3)}
.removed .btn{margin-top:var(--gap-4)}
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
// Copy helpers
// ---------------------------------------------------------------------------

/**
 * The Android dead-tap recovery line (copy review 2026-09-06, R9/G3). Rendered
 * hidden under every Add calendar button; the click handler reveals it when the
 * button restores itself, which is the only signal a phone gives that webcal://
 * went nowhere.
 */
const RECOVER_LINE =
  '<p class="recover" hidden>Didn\'t open? Android needs a computer — <a href="#other-calendars">see below ↓</a></p>';

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
function numberWord(n: number): string {
  return NUMBER_WORDS[n] ?? String(n);
}

/** `1 set`, `4 stages`. */
function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

/** The color of the stage at YAML position `i`: assigned by order and then frozen (references/color.md). */
function stageColor(i: number): string {
  return STAGE_COLORS[i % STAGE_COLORS.length]!;
}

/**
 * The human name for a festival's time zone, for the footer stamp. The IANA id
 * stays in the data and the feeds; the page says what a festival-goer would say.
 * Unknown zones fall back to the zone's city name.
 */
const ZONE_LABELS: Record<string, string> = {
  'America/Los_Angeles': 'Pacific',
  'America/Vancouver': 'Pacific',
  'America/Denver': 'Mountain',
  'America/Phoenix': 'Arizona',
  'America/Chicago': 'Central',
  'America/New_York': 'Eastern',
  'America/Toronto': 'Eastern',
  'Europe/London': 'UK',
};
export function zoneLabel(tz: string): string {
  return ZONE_LABELS[tz] ?? (tz.split('/').pop() ?? tz).replace(/_/g, ' ');
}

/**
 * The short date form for a directory card's eyebrow: `Aug 7–9, 2026`,
 * `Aug 30 – Sep 1, 2026`, `Sep 19, 2026`, `Dec 31, 2026 – Jan 1, 2027`. The
 * year stays so two years of one festival read as two cards. Display only;
 * the ISO dates in the manifest are untouched.
 */
export function shortDates(first: string, last: string): string {
  const parse = (iso: string) => {
    const [y, m, d] = ymd(iso);
    return { y, m, d, mon: MONTHS[m - 1]!.slice(0, 3) };
  };
  const a = parse(first);
  const b = parse(last);
  if (a.y !== b.y) return `${a.mon} ${a.d}, ${a.y} – ${b.mon} ${b.d}, ${b.y}`;
  if (a.m !== b.m) return `${a.mon} ${a.d} – ${b.mon} ${b.d}, ${a.y}`;
  if (a.d !== b.d) return `${a.mon} ${a.d}–${b.d}, ${a.y}`;
  return `${a.mon} ${a.d}, ${a.y}`;
}

// ---------------------------------------------------------------------------
// Subscribe page
// ---------------------------------------------------------------------------

function stageCard(stage: StageEntry, color: string, feedUrl: string, festivalKey: string, dayDates: string[]): string {
  const webcal = feedUrl.replace(/^https:/, 'webcal:');
  const sets = count(stage.setCount, 'set');
  // The year lives in the page title; repeating it on every card just makes the
  // mono caption wrap.
  const span = stage.dayspan.label.replace(/ \d{4}$/, '');
  return `<li class="stage-card" style="background:${color}">
  <div class="stage-art" style="background:${artGround(color)}">
    ${beadsArt(stage, color, dayDates)}
  </div>
  <div class="stage-body">
    <h3>${esc(stage.name)}</h3>
    <p class="meta">${sets} · ${esc(span)}</p>
    ${stage.description ? `<p class="desc">${esc(stage.description)}</p>` : ''}
    <div class="actions">
      <a class="btn btn--on-color" href="${esc(webcal)}" data-festival="${esc(festivalKey)}" data-stage="${esc(stage.id)}">Add calendar</a>
      <button class="icon-btn icon-btn--on-color" data-copy="${esc(feedUrl)}" aria-label="Copy calendar link">${ICON_LINK}${ICON_CHECK}</button>
    </div>
    ${RECOVER_LINE}
  </div>
</li>`;
}

export function renderSubscribePage(m: Manifest): string {
  const f = m.festival;
  const title = `${f.name} ${f.year} — set times by stage`;
  const desc = `${f.name} ${f.year} set times, one calendar per stage. Add the stages you care about to your phone.`;

  const dayDates = m.all.dayspan.first ? dateRange(m.all.dayspan.first, m.all.dayspan.last) : [];
  const cards = m.stages
    .map((s, i) => stageCard(s, stageColor(i), `${PROD_ORIGIN}${s.icsPath}`, f.key, dayDates))
    .join('\n');

  const allUrl = `${PROD_ORIGIN}${m.all.icsPath}`;
  const allWebcal = allUrl.replace(/^https:/, 'webcal:');

  const unverified = m.verified
    ? ''
    : `<div class="banner">
  <strong>Not checked yet</strong>
  These times were read off the official posters by machine and nobody has checked them against
  the source. Don't plan your day around them yet.
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
          <a class="btn btn--ink" href="${esc(allWebcal)}" data-festival="${esc(f.key)}" data-stage="${esc(m.all.id)}">Add calendar</a>
          <button class="icon-btn" data-copy="${esc(allUrl)}" aria-label="Copy calendar link">${ICON_LINK}${ICON_CHECK}</button>
        </div>
        ${RECOVER_LINE}
      </li>
    </ul>
    <p class="small" style="margin-top:var(--gap-3)">
      Pick two or three. All ${numberWord(m.stages.length)} at once turns a day view into a wall of
      overlapping blocks.
    </p>
    <a class="text-btn" href="${esc(f.officialUrl)}">See the full lineup ↗</a>
  </section>

  <section id="other-calendars">
    <p class="eyebrow">Android, or on a computer?</p>

    <details>
      <summary>Google Calendar</summary>
      <div class="body">
        <p><strong>Desktop web only.</strong> Google Calendar cannot add a calendar by URL from
        the Android or iOS app at all — there is no menu for it. Tap the link icon on the stage
        card to copy its address. Then, on a computer:</p>
        <ol>
          <li>Open Google Calendar in a browser</li>
          <li>Settings → Add calendar → From URL</li>
          <li>Paste the stage's <code>https://</code> link and click Add calendar</li>
        </ol>
        <p>It then syncs to your phone. Google refreshes subscribed calendars on its own
        schedule — usually 12–24 hours, sometimes longer. Nothing on my end can make it faster.</p>
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
        <p>Tap Add calendar above. iOS opens Calendar and asks you to confirm — its sheet says
        "Subscribe", which is the same thing. That's the whole flow. iOS checks for changes about
        twice a day, so a corrected time reaches you within half a day.</p>
      </div>
    </details>
  </section>

  <footer>
    <p>Updated ${esc(humanStamp(m.lastUpdated))}. All times are local to the festival — ${esc(zoneLabel(f.timezone))}.</p>
    <p>Unofficial. Not affiliated with ${esc(f.name)}.</p>
    <p>Source: <a href="${esc(f.officialUrl)}">the official schedule</a>.</p>
    <p>Wrong time? <a href="https://github.com/jake-lunde/stage-times/issues">Tell me ↗</a></p>
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

  // Add calendar: the OS takes over and for a second or two nothing visible happens.
  // Acknowledge the tap, block re-fires, then restore — if Calendar opened, the
  // restore happens offscreen; if the platform silently ignored webcal:// (Android),
  // the button comes back and the recovery line under the card points at the
  // "Android, or on a computer?" section. "Opening Calendar…" is only ever true on
  // iOS, so the state label never ships without that recovery line (copy.md rule 3).
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
      var rec = sub.parentNode.parentNode.querySelector('.recover');
      if (rec) rec.hidden = false;
    }, 2500);
  }
});
</script>`;

  return page(title, desc, body);
}

// ---------------------------------------------------------------------------
// Removed page — a blocked edition
// ---------------------------------------------------------------------------

/**
 * What a blocked edition's URL serves instead of the subscribe page. Its feeds
 * still answer, empty, so a subscriber's calendar quietly goes blank; this page
 * is where "why" lives. No stage cards, no calendar buttons, no copy links —
 * one heading, two lines, and one pill to the official schedule.
 *
 * Copy: references/copy.md, "The removed page". The page does not say who asked
 * for the takedown: a rights-holder block and an uploader's self-removal read
 * the same to the person standing at the gate.
 */
export function renderBlockedPage(m: Manifest): string {
  const f = m.festival;
  const title = `${f.name} ${f.year} — set times removed`;
  const desc = `The ${f.name} ${f.year} set times were taken down. The official schedule still has them.`;

  const body = `<main class="wrap">
  <nav class="topbar">
    <a class="icon-btn" href="/" aria-label="Stage Times home">${ICON_BACK}</a>
  </nav>

  <header>
    <p class="lockup">Stage&nbsp;Times</p>
    <h2>${esc(f.name)} <span style="color:var(--ink-soft)">${f.year}</span></h2>
  </header>

  <section class="prose removed">
    <h3>Taken down</h3>
    <p>This page was taken down and its calendars are empty now. If you added a stage from here,
    it will come up blank the next time your calendar app checks — remove it whenever you like.</p>
    <p>The official schedule still has the times.</p>
    <a class="btn btn--primary" href="${esc(f.officialUrl)}">Official schedule</a>
  </section>

  <footer>
    <p>Updated ${esc(humanStamp(m.lastUpdated))}.</p>
    <p>Unofficial. Not affiliated with ${esc(f.name)}.</p>
    <p>Source: <a href="${esc(f.officialUrl)}">the official schedule</a>.</p>
  </footer>
</main>`;

  return page(title, desc, body);
}

// ---------------------------------------------------------------------------
// Landing page — the directory of listed editions (ticket 06)
// ---------------------------------------------------------------------------

export interface LandingOptions {
  /**
   * Site-absolute paths to committed festival images, keyed by festival key,
   * e.g. `{ 'capitol-hill-block-party-2026': '/assets/festivals/capitol-hill-block-party-2026.webp' }`.
   * A card with no entry draws the Facets core instead.
   */
  images?: Record<string, string>;
}

/**
 * The editions the homepage shows: listed and not blocked, by first festival
 * day ascending, then name, then path. The build never reads a clock, so there
 * is no "past" and no "this weekend" — every listed edition is on the shelf.
 * Plain comparisons, not localeCompare: the order must not depend on the host.
 */
export function listedEditions(site: SiteManifest): Manifest[] {
  const by = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  return site.editions
    .filter((m) => m.listed && !m.blocked)
    .sort(
      (a, b) =>
        by(a.all.dayspan.first, b.all.dayspan.first) ||
        by(a.festival.name, b.festival.name) ||
        by(a.festival.basePath, b.festival.basePath),
    );
}

/**
 * One directory card, text first: eyebrow, the festival name, one bold lead
 * with the counts, the quiet lines, then art edge to edge to the bottom of the
 * fixed-height card. The whole card is the link; nothing inside it is a button.
 *
 * The eyebrow is the dates and city. On a fan edition the fan-made mark takes
 * that slot (owner ruling 4, 2026-09-20) and the dates drop to the first quiet
 * line, so a fan card still says when. The last quiet line is the first stage's
 * billed headliners — the main stage by convention — as the data has them.
 */
function directoryCard(m: Manifest, image: string | undefined): string {
  const f = m.festival;
  const fan = m.namespace === 'fan';
  const when = shortDates(m.all.dayspan.first, m.all.dayspan.last) + (f.city ? ` · ${f.city}` : '');
  const eyebrow = fan
    ? `<span class="eyebrow eyebrow--fan">Fan-made</span>`
    : `<span class="eyebrow">${esc(when)}</span>`;
  const quiet = [...(fan ? [when] : []), m.stages[0]?.headliners.join(' · ') ?? '']
    .filter((line) => line !== '')
    .map((line) => `<span class="shelf-meta">${esc(line)}</span>`)
    .join('\n        ');
  // The art ground is the edition's first stage's color — the main stage by convention.
  const color = stageColor(0);
  const art = image ? `<img src="${esc(image)}" alt="" loading="lazy">` : facetsArt(f.key, color, f.basePath);
  return `<li><a class="shelf-card" href="${esc(f.basePath)}/">
      <span class="shelf-text">
        ${eyebrow}
        <span class="shelf-title">${esc(f.name)}</span>
        <span class="shelf-lead">${count(m.allSetCount, 'set')} across ${count(m.stages.length, 'stage')}.</span>
        ${quiet}
      </span>
      <span class="shelf-art" style="background:${artGround(color)}">${art}</span>
    </a></li>`;
}

export function renderLandingPage(site: SiteManifest, opts: LandingOptions = {}): string {
  const listed = listedEditions(site);
  const shelf =
    listed.length === 0
      ? ''
      : `<section class="shelf-section">
    <h2 class="shelf-head"><span class="lead">Pick a festival.</span> <span class="tail">Then add the stages you want.</span></h2>
    <ul class="shelf">
    ${listed.map((m) => directoryCard(m, opts.images?.[m.festival.key])).join('\n    ')}
    </ul>
  </section>

  `;

  const body = `<header class="hero">
  <div class="wrap">
    <h1>Stage<br>Times</h1>
    <p>Set times, by stage.</p>
  </div>
</header>

<main class="wrap">
  ${shelf}<section class="prose">
    <p class="eyebrow">What this is</p>
    <p>Add one calendar per stage. The sets show up in the calendar app you already use, and you
    can color or hide each stage on its own.</p>
    <p>Two or three stages is usually all you want. Add those, skip the rest.</p>
  </section>

  <footer>
    <p>Times come from each festival's official schedule. Each festival page says when it was last checked.</p>
    <p>Unofficial. Not affiliated with any festival.</p>
    <p>Wrong time? <a href="https://github.com/jake-lunde/stage-times/issues">Tell me ↗</a></p>
  </footer>
</main>`;

  return page('Stage Times — set times, by stage', 'Set times for each festival stage, as a calendar you can add to your phone.', body);
}

// ---------------------------------------------------------------------------
// Entry point for the whole site — every edition, both namespaces
// ---------------------------------------------------------------------------

const ASSETS_SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'assets');
const IMAGE_EXTS = ['webp', 'jpg', 'jpeg', 'png', 'avif'];

/**
 * A committed festival image per edition that has one: `assets/festivals/<key>.<ext>`,
 * served from `/assets/festivals/`. Committed bytes in, so the build stays deterministic.
 */
function committedImages(site: SiteManifest): Record<string, string> {
  const images: Record<string, string> = {};
  for (const m of site.editions) {
    const key = m.festival.key;
    const ext = IMAGE_EXTS.find((e) => existsSync(join(ASSETS_SRC, 'festivals', `${key}.${e}`)));
    if (ext) images[key] = `/assets/festivals/${key}.${ext}`;
  }
  return images;
}

/**
 * Called by build.ts after the feeds are written. Emits:
 *   dist/index.html                          landing — one card per listed edition
 *   dist/<key>/index.html                    subscribe page, owner edition
 *   dist/fan/<key>/index.html                subscribe page, fan edition
 *   …or the removed page at the same path when the edition is blocked
 *   dist/assets/**                           self-hosted fonts + festival art
 */
export function renderSitePages(site: SiteManifest, outDir: string): string[] {
  const written: string[] = [];

  if (existsSync(ASSETS_SRC)) {
    cpSync(ASSETS_SRC, join(outDir, 'assets'), { recursive: true });
    written.push('assets/');
  }

  writeFileSync(join(outDir, 'index.html'), renderLandingPage(site, { images: committedImages(site) }), 'utf8');
  written.push('index.html');

  for (const m of site.editions) {
    const rel = m.festival.basePath.replace(/^\//, '');
    const dir = join(outDir, rel);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'index.html'), m.blocked ? renderBlockedPage(m) : renderSubscribePage(m), 'utf8');
    written.push(`${rel}/index.html`);
  }

  return written;
}
