/**
 * Stage Times — the upload flow: one static page at `/upload/`, five screens.
 *
 *   details     festival name, first and last day, an email — one form
 *   upload      one file action; the image is checked and posted from here
 *   review      the uploader's own image beside every set the model read, with
 *               the inferred-end and look-closer flags, artist/start/end edits
 *               inline, a "can't read it" toggle that blocks confirm, and the
 *               time zone shown as a guess and changeable
 *   publishing  the honest wait: the times are saved, the page is building,
 *               and the update link is handed over now rather than after
 *   success     the share link and the update link, explained in one line
 *
 * The update link opens the same flow for one edition (ticket 09), rendered
 * once per fan edition at `/update/<edition path>/`: the header names the
 * festival and the details screen says what a new screenshot will replace
 * before anything is uploaded; the secret rides in the fragment and goes out
 * with upload and confirm, and a correction replaces the times in place. Two
 * more screens hang off it:
 *
 *   remove      take it down — one destructive button, one way back
 *   removed     what happens next, in one line
 *
 * Rendered by `renderSitePages` in src/pages.ts, sharing its shell (tokens,
 * fonts, analytics snippet, footer voice). Everything the flow *decides* lives
 * in src/publisher.ts and reaches the page as JSON through the two adapters in
 * api/; the script here reads fields, checks the image before it costs
 * anything, shows one screen at a time, and repeats the publisher's own words
 * for every rejection. The one rule it repeats is the publisher's own: a set
 * marked unreadable blocks confirm, and the reason is the publisher's sentence.
 *
 * Deterministic and self-contained like every other page: no clock at render
 * time, no randomness, nothing fetched from anywhere but this origin. The
 * browser reads its own clock only to give up waiting for a build.
 *
 * Visual system: .claude/skills/stage-times-design/ (SKILL.md, copy.md,
 * screens.md — the third page type).
 */

import { ACCEPTED_IMAGE_TYPES, EMAIL_RE, GATE_COPY, MAX_IMAGE_EDGE, MIN_IMAGE_EDGE, fill, type Gate } from './publisher.js';
import { esc, ICON_BACK, ICON_CHECK, ICON_LINK, page, PROD_ORIGIN } from './pages.js';

export type Screen = 'details' | 'upload' | 'review' | 'publishing' | 'success' | 'remove' | 'removed';

/**
 * Where each gate's rejection lands. A typo in the form goes back to the form;
 * anything about the image — or the caps, which the reader can only wait out —
 * goes back to the one file action; a review that will not build stays on
 * review. The script carries this same map verbatim.
 */
export const GATE_SCREENS: Record<Gate, Screen> = {
  details: 'details',
  images: 'upload',
  type: 'upload',
  size: 'upload',
  dimensions: 'upload',
  'address-cap': 'upload',
  'daily-cap': 'upload',
  schedule: 'upload',
  expired: 'upload',
  review: 'review',
  schema: 'review',
  year: 'upload',
  stages: 'upload',
  removed: 'details',
  'update-link': 'remove',
};

/**
 * The zones the review offers, in the words a festival-goer uses. The source
 * image cannot carry a zone, so the review shows the publisher's assumption
 * and this list to change it. A zone outside the list (an owner edition in
 * some other city) is added to the select at run time under its own id.
 */
export const REVIEW_ZONES: { id: string; label: string }[] = [
  { id: 'America/Los_Angeles', label: 'Pacific' },
  { id: 'America/Denver', label: 'Mountain' },
  { id: 'America/Phoenix', label: 'Arizona' },
  { id: 'America/Chicago', label: 'Central' },
  { id: 'America/New_York', label: 'Eastern' },
  { id: 'America/Anchorage', label: 'Alaska' },
  { id: 'Pacific/Honolulu', label: 'Hawaii' },
  { id: 'America/Mexico_City', label: 'Mexico City' },
  { id: 'Europe/London', label: 'UK' },
  { id: 'Europe/Berlin', label: 'Central Europe' },
  { id: 'Australia/Sydney', label: 'Eastern Australia' },
];

// ---------------------------------------------------------------------------
// The time edits — plain functions, tested in node, embedded in the page by
// source (`Function.prototype.toString`), so the browser runs exactly what the
// tests ran. Nothing here may close over module scope or use TS-only syntax.
// ---------------------------------------------------------------------------

/** `YYYY-MM-DD` plus `n` days. */
export function addDay(iso: string, n: number): string {
  var p = iso.split('-').map(Number);
  return new Date(Date.UTC(p[0]!, p[1]! - 1, p[2]! + n)).toISOString().slice(0, 10);
}

/**
 * A corrected start, as the wall time the review carries. A night runs until
 * 6 AM (CONTEXT: headliner), so a start moved across midnight moves its date:
 * 11:45 PM read as 12:15 AM is the next morning, and the reverse is the
 * evening before.
 */
export function editedStart(originalStart: string, hhmm: string): string {
  var date = originalStart.slice(0, 10);
  var was = originalStart.slice(11, 16);
  if (hhmm < '06:00' && was >= '06:00') date = addDay(date, 1);
  else if (hhmm >= '06:00' && was < '06:00') date = addDay(date, -1);
  return date + 'T' + hhmm + ':00';
}

/** An end at or before the start's clock time is the next morning. */
export function editedEnd(start: string, hhmm: string): string {
  var date = start.slice(0, 10);
  if (hhmm <= start.slice(11, 16)) date = addDay(date, 1);
  return date + 'T' + hhmm + ':00';
}

/**
 * The update link: the edition's path under `/update/`, the secret in the
 * fragment so it never reaches a server log. Ticket 09 builds what it opens;
 * this is the one place its shape is decided.
 */
export function updateLink(editionPath: string, secret: string): string {
  return `${PROD_ORIGIN}/update/${editionPath}/#${secret}`;
}

/** Where the update-link page for an edition is written under dist/: `update/<edition path>`. */
export function updatePagePath(editionPath: string): string {
  return `update/${editionPath}`;
}

/**
 * What the browser checks before it posts, and how it shrinks a photo so the
 * request fits under the platform's body cap (well below the publisher's own
 * 10 MB). A screenshot never needs shrinking; a 12-megapixel photo of a poster
 * does. The same bytes go to upload and to confirm, so the hash matches.
 */
const LIMITS = {
  minEdge: MIN_IMAGE_EDGE,
  maxEdge: MAX_IMAGE_EDGE,
  types: ACCEPTED_IMAGE_TYPES,
  /** Bytes to post at most; base64 adds a third, and the platform caps the body around 4.5 MB. */
  postBytes: 2_800_000,
  /** Long edge to shrink to when a photo is over the byte budget or the publisher's edge cap. */
  postEdge: 3000,
};

// ---------------------------------------------------------------------------
// CSS — this page's own rules, on top of the shared tokens
// ---------------------------------------------------------------------------

const CSS = `
/* ── upload flow ─────────────────────────────────────────────────────────── */
.screen{margin-top:var(--gap-4)}
.screen h3{margin-bottom:var(--gap-2)}
.lead{margin:0; max-width:44ch}
.field{display:block; margin-top:var(--gap-3)}
.field>span:first-child{display:block; font-size:var(--t-small); font-weight:600; margin-bottom:6px}
/* Fields are the one non-capsule control: 52pt tall, 8pt radius, sunk fill, no shadow. */
.field input,.field select{
  display:block; width:100%; height:52px; border-radius:8px;
  border:1px solid var(--paper-line); background:var(--paper-sunk); color:var(--ink);
  font:inherit; font-size:var(--t-body); padding:0 14px; margin:0;
}
.field input{-webkit-appearance:none; appearance:none}
.field input:focus,.field select:focus,.times input:focus{outline:2px solid var(--red-deep); outline-offset:2px}
.field-pair{display:grid; grid-template-columns:1fr 1fr; gap:var(--gap-1)}
.hint{display:block; margin-top:6px; font-family:var(--font-mono); font-size:var(--t-mono); color:var(--ink-soft); line-height:1.5}
.problem{
  background:var(--yellow); color:#12181F; border-radius:var(--r-card);
  padding:var(--gap-3); margin:var(--gap-3) 0 0; font-size:var(--t-small); font-weight:500;
}
.problem ul{margin:8px 0 0; padding-left:1.2em}
.status{font-family:var(--font-mono); font-size:var(--t-mono); color:var(--ink-soft); margin:var(--gap-2) 0 0}
.screen>.btn--primary,.screen>form>.btn--primary{margin-top:var(--gap-4)}
.screen .text-btn{margin-top:var(--gap-2)}
/* A text button that is a <button>: strip the UA fill so it is the bare label the skill asks for. */
button.text-btn{background:none; border:0; padding:0; font-family:inherit}
.file-btn{position:relative; overflow:hidden}
.file-btn input{position:absolute; inset:0; width:100%; height:100%; opacity:0; cursor:pointer; font-size:0}

/* the uploader's own image, in a card, tall enough to read a poster off */
.source{margin:var(--gap-4) 0 0; background:var(--paper-sunk); border-radius:var(--r-card); overflow:hidden}
.source img{display:block; width:100%; height:auto; max-height:70vh; object-fit:contain}
.source figcaption{padding:0 var(--pad-card) 6px}

/* the review rows: one set at a time, no dividers */
.stage-group{margin-top:var(--gap-5)}
.stage-group .eyebrow{margin-bottom:var(--gap-1)}
.sets{list-style:none; margin:0; padding:0}
.set{padding:var(--gap-3) 0 var(--gap-4)}
.set .field{margin-top:0}
.set .field input{font-weight:600}
.times{display:flex; align-items:center; gap:var(--gap-1); margin-top:var(--gap-1)}
.times input{
  height:44px; border-radius:8px; border:1px solid var(--paper-line);
  background:var(--paper-sunk); color:var(--ink); font:inherit; font-size:var(--t-body);
  padding:0 8px; margin:0; min-width:0; flex:1; -webkit-appearance:none; appearance:none;
}
.printed{margin:6px 0 0}
.chips{display:flex; flex-wrap:wrap; gap:var(--gap-1); margin-top:var(--gap-2)}
.chip{
  display:inline-flex; align-items:center; height:32px; padding:0 14px; border-radius:16px;
  background:var(--yellow); color:#12181F; font-size:var(--t-small); font-weight:600;
}
.set .btn--sm{width:auto; padding:0 var(--gap-4); margin-top:var(--gap-2)}
.blocked{margin:var(--gap-2) 0 0}

/* links on the way out */
.link-row{display:flex; align-items:center; gap:var(--gap-1); margin-top:var(--gap-1)}
.link-row code.url{flex:1; margin-top:0}
.btn--danger{color:var(--red-deep)}
.vh{position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0); white-space:nowrap}
@media (max-width:359px){
  .field-pair{grid-template-columns:1fr}
}
`;

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

/** What the update-link page needs of an edition's manifest. */
export interface UpdateTarget {
  festival: { name: string; year: number; basePath: string };
  blocked: boolean;
  all: { dayspan: { first: string; last: string } };
}

/**
 * The upload flow. With no edition it is `/upload/`, adding a new festival.
 * With one it is that edition's update-link page: the same screens, but it
 * names the festival up front, says what a new screenshot replaces before
 * anything is uploaded, and offers taking it down. A taken-down edition's page
 * says so and offers nothing.
 */
export function renderUploadPage(edition?: UpdateTarget): string {
  if (edition?.blocked) return renderRemovedUpdatePage(edition);
  const zones = REVIEW_ZONES.map((z) => `<option value="${esc(z.id)}">${esc(z.label)}</option>`).join('');
  const f = edition?.festival;
  const pageAddress = f ? `${PROD_ORIGIN.replace(/^https:\/\//, '')}${f.basePath}/` : '';
  const value = (v: string | undefined) => (v ? ` value="${esc(v)}"` : '');

  const header = f
    ? `<header>
    <p class="lockup">Stage&nbsp;Times</p>
    <h2>${esc(f.name)} <span style="color:var(--ink-soft)">${f.year}</span></h2>
    <p class="title-meta mono-cap">Fix a time or take it down</p>
  </header>`
    : `<header>
    <p class="lockup">Stage&nbsp;Times</p>
    <h2>Add a festival</h2>
    <p class="title-meta mono-cap">From one screenshot of the set times</p>
  </header>`;

  const changing = f
    ? `
    <p class="lead" data-changing>A new screenshot replaces every time on <a href="${esc(f.basePath)}/">${esc(pageAddress)}</a>. Anyone who added a stage gets the new times the next time their calendar app checks.</p>`
    : '';

  const removeAction = f
    ? `
    <button class="text-btn" type="button" data-back="remove">Take it down</button>`
    : '';

  const removeScreens = f
    ? `

  <section class="screen" data-screen="remove" hidden>
    <h3>Take it down</h3>
    <p class="lead">Its calendars go empty and the page says it was taken down. Anyone who added a stage sees it come up blank the next time their calendar app checks.</p>
    <p class="problem" role="alert" hidden></p>
    <button class="btn btn--tonal btn--danger" type="button" data-remove>Take it down</button>
    <button class="text-btn" type="button" data-back="details">Keep it</button>
  </section>

  <section class="screen" data-screen="removed" hidden>
    <h3>Taken down</h3>
    <p class="lead">The page and its calendars empty out in a couple of minutes.</p>
  </section>`
    : '';

  const publishingLead = f
    ? 'Your new times are saved. The page takes a couple of minutes to rebuild, and this waits for it.'
    : 'Your times are saved. The page and its calendars take a couple of minutes to build, and this waits for them.';

  const publishingLink = f
    ? ''
    : `
    <p class="eyebrow" style="margin-top:var(--gap-5)">Your update link</p>
    <div class="link-row"><code class="url" data-update></code><button class="icon-btn" data-copy aria-label="Copy update link">${ICON_LINK}${ICON_CHECK}</button></div>
    <p class="small">Keep this one now, while it builds. It's the only way to fix a time or take the page down later, and it's shown once.</p>`;

  const successLive = f
    ? `<h3>It's live</h3>
      <p class="lead">The new times are on your page. Calendars pick them up the next time they check.</p>`
    : `<h3>It's live</h3>
      <p class="lead">Add a stage from your page like anyone would, and send the link around.</p>`;

  const successLinks = f
    ? ''
    : `
    <p class="eyebrow" style="margin-top:var(--gap-4)">Your update link</p>
    <div class="link-row"><code class="url" data-update></code><button class="icon-btn" data-copy aria-label="Copy update link">${ICON_LINK}${ICON_CHECK}</button></div>
    <p class="small">Keep this one. It's the only way to fix a time or take the page down later, and it's shown once.</p>
    <p class="small">Not on the homepage yet. I list festivals by hand.</p>`;

  const body = `<main class="wrap">
  <nav class="topbar">
    <a class="icon-btn" href="/" aria-label="Stage Times home">${ICON_BACK}</a>
  </nav>

  ${header}

  <section class="screen" data-screen="details">${changing}
    <form id="details" novalidate>
      <label class="field"><span>Festival</span><input name="festival" type="text" autocomplete="off" autocapitalize="words" required${value(f?.name)}></label>
      <div class="field-pair">
        <label class="field"><span>First day</span><input name="first" type="date" required${value(edition?.all.dayspan.first)}></label>
        <label class="field"><span>Last day</span><input name="last" type="date" required${value(edition?.all.dayspan.last)}></label>
      </div>
      <label class="field"><span>Email</span><input name="email" type="email" inputmode="email" autocomplete="email" required>
        <span class="hint">Only so I can reach you about a wrong time. No account, and nothing gets sent to it.</span></label>
      <p class="problem" role="alert" hidden></p>
      <button class="btn btn--primary" type="submit">Next</button>
    </form>${removeAction}
  </section>

  <section class="screen" data-screen="upload" hidden>
    <h3>Your screenshot</h3>
    <p class="lead">The schedule with the times on it, not the lineup. A screenshot from the app or a photo of the poster both work.</p>
    <p class="problem" role="alert" hidden></p>
    <p class="status" aria-live="polite" hidden></p>
    <label class="btn btn--primary file-btn"><span>Choose image</span><input type="file" accept="image/*" name="image"></label>
  </section>

  <section class="screen" data-screen="review" hidden>
    <h3>Check every set</h3>
    <p class="lead">Against your image. Fix what's off, and mark anything you can't read.</p>
    <p class="status" data-address></p>
    <figure class="source"><img alt="Your image"><figcaption><a class="text-btn" target="_blank" rel="noopener">See it bigger ↗</a></figcaption></figure>
    <p class="problem" role="alert" hidden></p>
    <p class="problem" data-year hidden></p>
    <label class="field"><span>Time zone</span><select name="timezone">${zones}</select>
      <span class="hint" data-zone-hint>A guess, since the image can't say. Change it if the festival is somewhere else.</span></label>
    <div id="sets"></div>
    <template id="set-row">
      <li class="set" data-index="">
        <label class="field"><span class="vh">Artist</span><input type="text" data-field="artist" autocomplete="off"></label>
        <div class="times">
          <input type="time" aria-label="Start" data-field="start">
          <span aria-hidden="true">–</span>
          <input type="time" aria-label="End" data-field="end">
        </div>
        <p class="small printed"><span class="mono-cap" data-day></span> · Printed <span data-printed></span></p>
        <div class="chips"><span class="chip" data-flag="end">End is a guess</span><span class="chip" data-flag="low">Look closer</span></div>
        <button class="btn btn--sm btn--tonal" type="button" data-unreadable aria-pressed="false">Can't read it</button>
      </li>
    </template>
    <details class="notes" hidden>
      <summary>Notes from the read</summary>
      <div class="body"><ul data-observations></ul></div>
    </details>
    <button class="btn btn--primary" type="button" data-confirm>Confirm</button>
    <p class="small blocked" data-blocked hidden></p>
    <button class="text-btn" type="button" data-back="upload">Different image</button>
  </section>

  <section class="screen" data-screen="publishing" hidden>
    <h3>Building your page</h3>
    <p class="lead">${publishingLead}</p>
    <p class="status" aria-live="polite" data-publish-status>Checking again every ten seconds.</p>${publishingLink}
  </section>

  <section class="screen" data-screen="success" hidden>
    <div data-live>
      ${successLive}
    </div>
    <div data-late hidden>
      <h3>Nearly there</h3>
      <p class="lead">Still building after five minutes, which is longer than usual. The links don't change, and they'll work once it's done.</p>
    </div>
    <p class="eyebrow" style="margin-top:var(--gap-5)">Your page</p>
    <div class="link-row"><code class="url" data-share></code><button class="icon-btn" data-copy aria-label="Copy page link">${ICON_LINK}${ICON_CHECK}</button></div>${successLinks}
    <a class="btn btn--primary" data-open>Open your page</a>
  </section>${removeScreens}

  <footer>
    <p>Anything put on here is checked by the person who put it there, against their own image, before it goes live.</p>
    <p>Unofficial. Not affiliated with any festival.</p>
    <p>Wrong time? <a href="https://github.com/jake-lunde/stage-times/issues">Tell me ↗</a></p>
  </footer>
</main>

<script>
(function () {
  'use strict';
  var GATES = ${JSON.stringify(GATE_SCREENS)};
  var LIMITS = ${JSON.stringify(LIMITS)};
  var COPY = ${JSON.stringify(GATE_COPY)};
  var EMAIL_RE = ${EMAIL_RE.toString()};
  ${fill.toString()}
  var ORIGIN = '${PROD_ORIGIN}';
  var UPDATE_LINK = ${JSON.stringify(updateLink('{path}', '{secret}'))};
  // The edition this page changes, or null on /upload/. The secret is the link's
  // fragment: it never reaches a server log, and it goes out only in a body.
  var UPDATE = ${JSON.stringify(f ? { editionPath: f.basePath.replace(/^\//, '') } : null)};
  function updateClaim() { return UPDATE ? { editionPath: UPDATE.editionPath, secret: location.hash.slice(1) } : undefined; }
  var WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  var BUILD_WAIT_MS = 5 * 60 * 1000;
  var POLL_MS = 10 * 1000;

  var state = { details: null, image: null, imageUrl: null, review: null, unreadable: {}, timezoneAssumed: true, published: null, live: false };

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  var screens = {};
  $$('[data-screen]').forEach(function (s) { screens[s.getAttribute('data-screen')] = s; });
  function show(name) {
    Object.keys(screens).forEach(function (k) { screens[k].hidden = k !== name; });
    window.scrollTo(0, 0);
  }

  // One yellow line per screen. Empty text hides it.
  function problem(name, text, list) {
    var p = $('.problem', screens[name]);
    p.textContent = text || '';
    if (list && list.length) {
      var ul = document.createElement('ul');
      list.forEach(function (item) { var li = document.createElement('li'); li.textContent = item; ul.appendChild(li); });
      p.appendChild(ul);
    }
    p.hidden = !text;
  }
  function fail(name, body) {
    var reason = body && body.reason ? body.reason : 'Something went wrong on my end. Try again in a minute.';
    var rest = body && body.problems && body.problems.length > 1 ? body.problems.slice(1) : null;
    problem(name, reason, rest);
  }
  function screenFor(gate, fallback) { return GATES[gate] || fallback; }

  function post(path, body) {
    return fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (res) {
        return res.json().catch(function () { return null; }).then(function (parsed) {
          if (!parsed) {
            parsed = { ok: false, reason: res.status === 413
              ? 'That image is too big to send. A screenshot is usually fine; a photo of a poster may need to be smaller.'
              : 'Something went wrong on my end. Try again in a minute.' };
          }
          return { ok: res.ok && parsed.ok === true, status: res.status, body: parsed };
        });
      }, function () {
        return { ok: false, status: 0, body: { reason: 'It didn\\'t go through. Check your signal and try again.' } };
      });
  }

  // ── details ──────────────────────────────────────────────────────────────
  $('#details').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target;
    var d = { festival: f.festival.value.trim(), first: f.first.value, last: f.last.value, email: f.email.value.trim() };
    if (!d.festival) return problem('details', COPY.festival);
    if (!d.first || !d.last || d.last < d.first) return problem('details', COPY.dates);
    if (!EMAIL_RE.test(d.email)) return problem('details', COPY.email);
    problem('details', '');
    state.details = d;
    show('upload');
  });

  // ── upload ───────────────────────────────────────────────────────────────
  var fileInput = $('input[type="file"]');
  fileInput.addEventListener('change', function () {
    var file = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (file) takeImage(file);
  });

  function loadImage(blob) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(blob);
      var img = new Image();
      img.onload = function () { resolve({ img: img, url: url }); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('decode')); };
      img.src = url;
    });
  }
  function toBlob(canvas, quality) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (b) { b ? resolve(b) : reject(new Error('encode')); }, 'image/jpeg', quality);
    });
  }
  // Shrink a photo until it fits the budget: a screenshot never gets here.
  function shrink(img) {
    var steps = [[LIMITS.postEdge, 0.85], [Math.round(LIMITS.postEdge * 0.75), 0.75], [Math.round(LIMITS.postEdge * 0.55), 0.7]];
    var long = Math.max(img.naturalWidth, img.naturalHeight);
    var i = 0;
    function attempt() {
      var edge = steps[i][0], quality = steps[i][1];
      var scale = Math.min(1, edge / long);
      var w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale);
      var c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      return toBlob(c, quality).then(function (blob) {
        i += 1;
        if (blob.size <= LIMITS.postBytes || i >= steps.length) return { blob: blob, width: w, height: h };
        return attempt();
      });
    }
    return attempt();
  }
  function base64(blob) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(String(r.result).split(',')[1]); };
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  }
  function mb(bytes) { return (bytes / (1024 * 1024)).toFixed(1).replace(/\\.0$/, ''); }

  function takeImage(file) {
    problem('upload', '');
    if (LIMITS.types.indexOf(file.type) === -1) {
      return problem('upload', COPY.notImage);
    }
    loadImage(file).then(function (loaded) {
      var img = loaded.img;
      var w = img.naturalWidth, h = img.naturalHeight;
      var short = Math.min(w, h), long = Math.max(w, h);
      if (short < LIMITS.minEdge) {
        URL.revokeObjectURL(loaded.url);
        return problem('upload', fill(COPY.tooSmall, { short: short, min: LIMITS.minEdge }));
      }
      var ready = (file.size > LIMITS.postBytes || long > LIMITS.postEdge)
        ? shrink(img)
        : Promise.resolve({ blob: file, width: w, height: h });
      return ready.then(function (fit) {
        URL.revokeObjectURL(loaded.url);
        if (fit.blob.size > LIMITS.postBytes) {
          return problem('upload', 'That image is still ' + mb(fit.blob.size) + ' MB after shrinking. A screenshot is usually well under that.');
        }
        return base64(fit.blob).then(function (data) {
          state.image = { blob: fit.blob, filename: file.name || 'image', contentType: fit.blob.type || file.type, width: fit.width, height: fit.height, data: data };
          if (state.imageUrl) URL.revokeObjectURL(state.imageUrl);
          state.imageUrl = URL.createObjectURL(fit.blob);
          return sendUpload();
        });
      });
    }, function () {
      problem('upload', 'I couldn\\'t open that image. Try a screenshot instead.');
    });
  }

  function imageBody() {
    var im = state.image;
    return { filename: im.filename, contentType: im.contentType, width: im.width, height: im.height, data: im.data };
  }

  function sendUpload() {
    var btn = $('.file-btn'), label = $('span', btn), status = $('.status', screens.upload);
    var d = state.details;
    btn.classList.add('is-loading');
    label.textContent = 'Reading\\u2026';
    status.textContent = 'Reading the times off your image. Usually under a minute.';
    status.hidden = false;
    return post('/api/upload', { festival: d.festival, dates: { first: d.first, last: d.last }, email: d.email, image: imageBody(), update: updateClaim() }).then(function (r) {
      btn.classList.remove('is-loading');
      label.textContent = 'Choose image';
      status.hidden = true;
      if (!r.ok) {
        var to = screenFor(r.body.gate, 'upload');
        fail(to, r.body);
        show(to);
        return;
      }
      state.review = r.body.review;
      state.unreadable = {};
      state.timezoneAssumed = state.review.timezoneAssumed;
      renderReview();
      show('review');
    });
  }

  // ── review ───────────────────────────────────────────────────────────────
  var zone = $('select[name="timezone"]');
  function dayLabel(iso) {
    var p = iso.slice(0, 10).split('-').map(Number);
    return WEEKDAYS[new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay()];
  }
  ${addDay.toString()}
  ${editedStart.toString()}
  ${editedEnd.toString()}
  function zoneHint() {
    $('[data-zone-hint]').textContent = state.timezoneAssumed
      ? 'A guess, since the image can\\'t say. Change it if the festival is somewhere else.'
      : 'Every time above is read in this zone.';
  }
  zone.addEventListener('change', function () { state.timezoneAssumed = false; zoneHint(); });

  function renderReview() {
    var rv = state.review;
    $('.source img').src = state.imageUrl;
    $('.source a').href = state.imageUrl;
    if (!$$('option', zone).some(function (o) { return o.value === rv.timezone; })) {
      var extra = document.createElement('option');
      extra.value = rv.timezone;
      extra.textContent = rv.timezone.split('/').pop().replace(/_/g, ' ');
      zone.appendChild(extra);
    }
    zone.value = rv.timezone;
    zoneHint();
    problem('review', '');
    var address = ORIGIN.replace(/^https:\\/\\//, '') + '/' + rv.editionPath + '/';
    $('[data-address]').textContent = !UPDATE ? 'Your page will be ' + address
      : rv.correcting ? 'This replaces the times on ' + address
      : 'That update link didn\\'t match, so this will be a new page: ' + address;
    var year = $('[data-year]');
    year.textContent = rv.yearMismatch ? 'The image reads as ' + rv.year + ', not the year you typed. Check your dates against it.' : '';
    year.hidden = !rv.yearMismatch;

    var host = $('#sets'), tpl = $('#set-row');
    host.textContent = '';
    rv.stages.forEach(function (stage) {
      var sets = rv.sets.filter(function (s) { return s.stage === stage.id; });
      if (!sets.length) return;
      var group = document.createElement('div');
      group.className = 'stage-group';
      var head = document.createElement('p');
      head.className = 'eyebrow';
      head.textContent = stage.name;
      group.appendChild(head);
      var ol = document.createElement('ol');
      ol.className = 'sets';
      sets.forEach(function (s) {
        var li = tpl.content.firstElementChild.cloneNode(true);
        li.setAttribute('data-index', String(s.index));
        $('[data-field="artist"]', li).value = s.artist;
        $('[data-day]', li).textContent = dayLabel(s.start);
        $('[data-field="start"]', li).value = s.start.slice(11, 16);
        $('[data-field="end"]', li).value = s.end.slice(11, 16);
        $('[data-printed]', li).textContent = s.printedTime;
        if (!s.endInferred) $('[data-flag="end"]', li).remove();
        if (!s.lowConfidence) $('[data-flag="low"]', li).remove();
        ol.appendChild(li);
      });
      group.appendChild(ol);
      host.appendChild(group);
    });

    var notes = $('details.notes'), list = $('[data-observations]');
    list.textContent = '';
    rv.observations.forEach(function (o) { var li = document.createElement('li'); li.textContent = o; list.appendChild(li); });
    notes.hidden = rv.observations.length === 0;
    notes.open = false;
    updateConfirm();
  }

  function updateConfirm() {
    var n = Object.keys(state.unreadable).length;
    var btn = $('[data-confirm]'), why = $('[data-blocked]');
    btn.disabled = n > 0;
    why.hidden = n === 0;
    why.textContent = n === 1 ? COPY.unreadableOne : fill(COPY.unreadableMany, { n: n });
  }

  screens.review.addEventListener('click', function (e) {
    var toggle = e.target.closest('[data-unreadable]');
    if (!toggle) return;
    var idx = toggle.closest('[data-index]').getAttribute('data-index');
    var on = toggle.getAttribute('aria-pressed') !== 'true';
    toggle.setAttribute('aria-pressed', on ? 'true' : 'false');
    toggle.textContent = on ? 'Marked unreadable' : 'Can\\'t read it';
    if (on) state.unreadable[idx] = true; else delete state.unreadable[idx];
    updateConfirm();
  });

  $('[data-confirm]').addEventListener('click', function () {
    var btn = this, rv = state.review, d = state.details;
    var edits = [], unverifiable = [];
    $$('#sets [data-index]').forEach(function (li) {
      var i = Number(li.getAttribute('data-index'));
      var s = rv.sets.filter(function (x) { return x.index === i; })[0];
      var e = { index: i };
      var artist = $('[data-field="artist"]', li).value.trim();
      if (artist && artist !== s.artist) e.artist = artist;
      var st = $('[data-field="start"]', li).value, en = $('[data-field="end"]', li).value;
      var start = st && st !== s.start.slice(11, 16) ? editedStart(s.start, st) : s.start;
      if (start !== s.start) e.start = start;
      // The end follows the start: a moved start can put an unchanged end before it.
      var end = (start !== s.start || (en && en !== s.end.slice(11, 16))) ? editedEnd(start, en || s.end.slice(11, 16)) : s.end;
      if (end !== s.end) e.end = end;
      if (Object.keys(e).length > 1) edits.push(e);
      if ($('[data-unreadable]', li).getAttribute('aria-pressed') === 'true') unverifiable.push(i);
    });
    problem('review', '');
    var was = btn.textContent;
    btn.classList.add('is-loading');
    btn.textContent = 'Saving\\u2026';
    var body = { festival: d.festival, email: d.email, timezone: zone.value, timezoneAssumed: state.timezoneAssumed, edits: edits, unverifiable: unverifiable, image: imageBody(), update: updateClaim() };
    // A correction's calendar already answers, so the wait is for it to change:
    // note what it answers with now, before the new times are sent.
    (rv.correcting ? currentTag(rv.editionPath) : Promise.resolve(null)).then(function (before) {
      return post('/api/confirm', body).then(function (r) { return { r: r, before: before }; });
    }).then(function (x) {
      var r = x.r;
      btn.classList.remove('is-loading');
      btn.textContent = was;
      if (!r.ok) {
        var to = screenFor(r.body.gate, 'review');
        fail(to, r.body);
        show(to);
        return;
      }
      state.published = r.body;
      var update = UPDATE_LINK.replace('{path}', r.body.editionPath).replace('{secret}', r.body.updateSecret);
      $$('[data-update]').forEach(function (el) { el.textContent = update; $('[data-copy]', el.parentNode).setAttribute('data-copy', update); });
      show('publishing');
      waitForBuild(r.body.editionPath, r.body.corrected ? x.before : null).then(showSuccess);
    });
  });

  // ── remove ───────────────────────────────────────────────────────────────
  var removeBtn = $('[data-remove]');
  if (removeBtn) removeBtn.addEventListener('click', function () {
    var btn = this, was = btn.textContent;
    problem('remove', '');
    btn.classList.add('is-loading');
    btn.textContent = 'Taking it down\\u2026';
    post('/api/remove', { update: updateClaim() }).then(function (r) {
      btn.classList.remove('is-loading');
      btn.textContent = was;
      if (!r.ok) { fail('remove', r.body); return; }
      show('removed');
    });
  });

  $$('[data-back]').forEach(function (b) {
    b.addEventListener('click', function () { show(b.getAttribute('data-back')); });
  });

  // ── publishing ───────────────────────────────────────────────────────────
  // The page is live when its all-stages calendar answers. Same origin only:
  // on the production site that is the real thing; anywhere else it times out
  // honestly.
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  // A correction is live when that calendar answers with something other than
  // what it answered before, the ETag taken just ahead of confirm.
  function currentTag(editionPath) {
    return fetch('/' + editionPath + '/all.ics', { method: 'HEAD', cache: 'no-store' }).then(function (res) {
      return res.ok ? res.headers.get('etag') : null;
    }, function () { return null; });
  }
  function waitForBuild(editionPath, before) {
    var status = $('[data-publish-status]');
    var url = '/' + editionPath + '/all.ics';
    var started = Date.now(), tries = 0;
    function check() {
      tries += 1;
      return fetch(url, { method: 'HEAD', cache: 'no-store' }).then(function (res) {
        return res.ok && (res.headers.get('content-type') || '').indexOf('text/calendar') === 0 &&
          (!before || res.headers.get('etag') !== before);
      }, function () { return false; }).then(function (live) {
        if (live) { state.live = true; return; }
        var elapsed = Date.now() - started;
        if (elapsed >= BUILD_WAIT_MS) { state.live = false; return; }
        status.textContent = tries < 3 ? 'Checking again every ten seconds.' : 'Still building. ' + Math.round(elapsed / 1000) + ' seconds so far.';
        return sleep(POLL_MS).then(check);
      });
    }
    return check();
  }

  // ── success ──────────────────────────────────────────────────────────────
  function showSuccess() {
    var share = ORIGIN + '/' + state.published.editionPath + '/';
    var el = $('[data-share]');
    el.textContent = share;
    $('[data-copy]', el.parentNode).setAttribute('data-copy', share);
    $('[data-open]').href = share;
    $('[data-live]').hidden = !state.live;
    $('[data-late]').hidden = state.live;
    show('success');
  }

  // Copy buttons, same as the subscribe page.
  document.addEventListener('click', function (e) {
    var copy = e.target.closest('[data-copy]');
    if (!copy) return;
    var value = copy.getAttribute('data-copy');
    if (!value || !navigator.clipboard) return;
    var was = copy.getAttribute('aria-label');
    navigator.clipboard.writeText(value).then(function () {
      copy.classList.add('copied');
      copy.setAttribute('aria-label', 'Link copied');
      setTimeout(function () {
        copy.classList.remove('copied');
        copy.setAttribute('aria-label', was);
      }, 1600);
    }, function () {});
  });
})();
</script>`;

  return f
    ? page(
        `${f.name} ${f.year} — fix a time`,
        `Fix a time on the ${f.name} ${f.year} set times, or take the page down.`,
        body,
        CSS,
      )
    : page(
        'Stage Times — add a festival',
        'Turn a screenshot of a festival’s set times into calendars, one per stage, from your phone.',
        body,
        CSS,
      );
}

/** The update link of an edition already taken down: it says so, and offers nothing to change. */
function renderRemovedUpdatePage(edition: UpdateTarget): string {
  const f = edition.festival;
  const body = `<main class="wrap">
  <nav class="topbar">
    <a class="icon-btn" href="/" aria-label="Stage Times home">${ICON_BACK}</a>
  </nav>

  <header>
    <p class="lockup">Stage&nbsp;Times</p>
    <h2>${esc(f.name)} <span style="color:var(--ink-soft)">${f.year}</span></h2>
  </header>

  <section class="screen" data-screen="removed">
    <h3>Taken down</h3>
    <p class="lead">This page was taken down, so there's nothing left to change here.</p>
  </section>

  <footer>
    <p>Unofficial. Not affiliated with ${esc(f.name)}.</p>
  </footer>
</main>`;
  return page(`${f.name} ${f.year} — taken down`, `The ${f.name} ${f.year} set times were taken down.`, body, CSS);
}
