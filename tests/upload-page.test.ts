/**
 * The upload flow (ticket 08): five screens on one static page, driven here
 * through the pages seam — render in, HTML string out.
 *
 * Nothing here runs the browser script. What is pinned is the static markup
 * each screen ships with, the copy on it, and the contract the script has with
 * the two adapters: the fields it posts, the limits it checks before posting,
 * and which screen each gate's rejection lands on. The live half — a phone,
 * a real image, a real deploy — is the smoke test on a preview.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ACCEPTED_IMAGE_TYPES, EMAIL_RE, GATE_COPY, MAX_IMAGE_EDGE, MIN_IMAGE_EDGE, type Gate } from '../src/publisher.js';
import { renderSitePages } from '../src/pages.js';
import { addDay, editedEnd, editedStart, GATE_SCREENS, renderUploadPage, REVIEW_ZONES, updateLink, updatePagePath, type Screen } from '../src/upload-pages.js';
import { buildFixtureSite, harborDoc, pierDoc, visibleText } from './helpers.js';

const html = renderUploadPage();
const text = visibleText(html);

/** The markup of one screen's section. */
function screen(name: Screen): string {
  const re = new RegExp(`<section class="screen"[^>]*data-screen="${name}"[^>]*>[\\s\\S]*?</section>`);
  const m = re.exec(html);
  assert.ok(m, `screen "${name}" is in the static markup`);
  return m![0];
}

const SCREENS: Screen[] = ['details', 'upload', 'review', 'publishing', 'success'];
const ALL_GATES: Gate[] = ['details', 'type', 'size', 'dimensions', 'address-cap', 'daily-cap', 'schedule', 'expired', 'review', 'schema', 'year', 'stages', 'removed', 'update-link'];

// ===========================================================================
// The screens
// ===========================================================================

test('upload page: every screen is in the static markup, and only the first one shows', () => {
  for (const name of SCREENS) screen(name);
  assert.doesNotMatch(screen('details'), /^<section[^>]*\bhidden\b/, 'the details screen is the one that shows');
  for (const name of SCREENS.slice(1)) {
    assert.match(screen(name), /^<section[^>]*\bhidden\b/, `${name} waits its turn`);
  }
});

test('upload page: each deciding screen has exactly one primary pill; the wait has none', () => {
  const count = (markup: string) => (markup.match(/btn--primary/g) ?? []).length;
  assert.equal(count(screen('details')), 1);
  assert.equal(count(screen('upload')), 1);
  assert.equal(count(screen('review')), 1);
  assert.equal(count(screen('success')), 1);
  assert.equal(count(screen('publishing')), 0, 'nothing to tap while it builds — except copy the link');
});

test('upload page: the details screen asks for the festival, its days, and an email, and nothing else', () => {
  const details = screen('details');
  const inputs = details.match(/<input[^>]*>/g) ?? [];
  assert.equal(inputs.length, 4);
  for (const name of ['festival', 'first', 'last', 'email']) {
    assert.ok(inputs.some((i) => i.includes(`name="${name}"`)), `field ${name}`);
  }
  assert.match(details, /name="first" type="date"/);
  assert.match(details, /name="email" type="email"/);
  assert.ok(details.includes('>Next</button>'), 'the one label');
  assert.ok(
    visibleText(details).includes('Only so I can reach you about a wrong time. No account, and nothing gets sent to it.'),
    'the email is a contact, not a sign-up',
  );
});

test('upload page: the upload screen is one file action that takes images only, and says what to pick', () => {
  const upload = screen('upload');
  assert.match(upload, /<label class="btn btn--primary file-btn"><span>Choose image<\/span><input type="file" accept="image\/\*" name="image"><\/label>/);
  assert.equal((upload.match(/<input/g) ?? []).length, 1, 'one control on the screen');
  assert.ok(
    visibleText(upload).includes('The schedule with the times on it, not the lineup. A screenshot from the app or a photo of the poster both work.'),
  );
});

test('upload page: the review screen shows the image beside the sets in the row-list idiom, flags visible, edits inline', () => {
  const review = screen('review');
  assert.match(review, /<figure class="source"><img alt="Your image">/);
  assert.match(review, /<template id="set-row">\s*<li class="set"/);
  for (const field of ['artist', 'start', 'end']) {
    assert.ok(review.includes(`data-field="${field}"`), `${field} is editable in the row`);
  }
  assert.match(review, /<input type="time"[^>]*data-field="start"/);
  assert.match(review, /<input type="time"[^>]*data-field="end"/);
  assert.ok(review.includes('<span class="chip" data-flag="end">End is a guess</span>'), 'the inferred-end flag');
  assert.ok(review.includes('<span class="chip" data-flag="low">Look closer</span>'), 'the low-confidence flag');
  assert.ok(review.includes('data-unreadable aria-pressed="false">Can\'t read it</button>'), 'the unverifiable toggle');
  assert.equal(review.includes('<hr'), false, 'no dividers in a row list');
  assert.ok(review.includes('<template id="set-row">'), 'rows come from one template');
});

test('upload page: an unreadable set disables confirm, with the same reason the publisher would give', () => {
  assert.ok(html.includes('btn.disabled = n > 0;'), 'confirm is disabled while any set is marked');
  assert.ok(html.includes('COPY.unreadableOne'), 'the singular reason is the publisher\'s');
  assert.ok(html.includes('fill(COPY.unreadableMany, { n: n })'), 'and the plural');
});

test("upload page: the browser speaks the publisher's own sentences, injected, never retyped", () => {
  assert.ok(html.includes(`var COPY = ${JSON.stringify(GATE_COPY)};`));
  assert.ok(html.includes(`var EMAIL_RE = ${EMAIL_RE.toString()};`));
  assert.ok(html.includes('function fill('), 'the placeholder filler rides along by source');
  const pageText = visibleText(html);
  for (const sentence of [GATE_COPY.festival, GATE_COPY.email, GATE_COPY.notImage]) {
    assert.equal(pageText.includes(sentence), false, `not baked into the markup: ${sentence}`);
  }
});

test('upload page: the time zone is shown as a guess and is changeable, in spoken names', () => {
  const review = screen('review');
  assert.match(review, /<select name="timezone">/);
  for (const zone of REVIEW_ZONES) {
    assert.ok(review.includes(`<option value="${zone.id}">${zone.label}</option>`), `${zone.label}`);
  }
  assert.ok(visibleText(review).includes("A guess, since the image can't say. Change it if the festival is somewhere else."));
  assert.equal(/America\//.test(text), false, 'no IANA id where a reader can see it');
  assert.ok(html.includes("state.timezoneAssumed = false;"), 'changing the zone clears the assumption');
});

test('upload page: the publishing state is honest about the wait, and hands over the update link while it builds', () => {
  const publishing = visibleText(screen('publishing'));
  assert.ok(publishing.includes('Building your page'));
  assert.ok(publishing.includes('Checking again every ten seconds.'), 'the cadence it states is the cadence it polls at');
  assert.ok(html.includes('var POLL_MS = 10 * 1000;'));
  assert.ok(publishing.includes('Your times are saved. The page and its calendars take a couple of minutes to build, and this waits for them.'));
  assert.ok(publishing.includes("Keep this one now, while it builds. It's the only way to fix a time or take the page down later, and it's shown once."));
  assert.ok(html.includes("'/all.ics'"), 'it waits by asking for the calendar itself');
  assert.ok(html.includes("cache: 'no-store'"), 'and never trusts a cached answer');
  assert.ok(html.includes("Still building after five minutes, which is longer than usual."), 'the timeout is a sentence, not a spinner');
});

test('upload page: the success screen shows the share link and the update link, the latter explained in one line', () => {
  const success = screen('success');
  assert.match(success, /<code class="url" data-share><\/code><button class="icon-btn" data-copy aria-label="Copy page link">/);
  assert.match(success, /<code class="url" data-update><\/code><button class="icon-btn" data-copy aria-label="Copy update link">/);
  const t = visibleText(success);
  assert.ok(t.includes("Keep this one. It's the only way to fix a time or take the page down later, and it's shown once."));
  assert.ok(t.includes('Not on the homepage yet. I list festivals by hand.'));
  assert.match(success, /<a class="btn btn--primary" data-open>Open your page<\/a>/);
});

test('updateLink: the secret rides in the fragment, under /update/ beside the edition', () => {
  assert.equal(updateLink('fan/low-tide-2026', 'abc123'), 'https://stagetimes.app/update/fan/low-tide-2026/#abc123');
  assert.ok(html.includes(`var UPDATE_LINK = ${JSON.stringify(updateLink('{path}', '{secret}'))};`), 'the page carries the same shape');
});

test('upload page: the review says where the page will live before anything is confirmed', () => {
  assert.match(screen('review'), /<p class="status" data-address><\/p>/);
  assert.ok(html.includes("var address = ORIGIN.replace("), 'filled from the review\'s edition path');
  assert.ok(html.includes("!UPDATE ? 'Your page will be ' + address"));
});

// ===========================================================================
// The contract with the adapters
// ===========================================================================

test("upload page: every gate's rejection has a screen to land on, and the script carries the same map", () => {
  for (const gate of ALL_GATES) assert.ok([...SCREENS, 'remove'].includes(GATE_SCREENS[gate]), `${gate} → ${GATE_SCREENS[gate]}`);
  assert.equal(GATE_SCREENS.details, 'details', 'a typo goes back to the form');
  for (const gate of ['type', 'size', 'dimensions', 'schedule', 'address-cap', 'daily-cap', 'expired'] as Gate[]) {
    assert.equal(GATE_SCREENS[gate], 'upload', `${gate}: pick another image, or wait`);
  }
  assert.equal(GATE_SCREENS.review, 'review');
  assert.equal(GATE_SCREENS.schema, 'review', 'a time that does not hold together is fixed on review');
  assert.ok(html.includes(`var GATES = ${JSON.stringify(GATE_SCREENS)};`));
});

test("upload page: the browser checks type and dimensions with the publisher's own limits before posting", () => {
  assert.ok(html.includes(`"minEdge":${MIN_IMAGE_EDGE}`));
  assert.ok(html.includes(`"maxEdge":${MAX_IMAGE_EDGE}`));
  assert.ok(html.includes(`"types":${JSON.stringify(ACCEPTED_IMAGE_TYPES)}`));
});

// ===========================================================================
// The time edits — the helpers the page embeds by source
// ===========================================================================

test('time edits: a corrected start that crosses midnight moves its date, either way', () => {
  assert.equal(editedStart('2026-10-09T23:45:00', '00:15'), '2026-10-10T00:15:00', '11:45 PM read as 12:15 AM is the next morning');
  assert.equal(editedStart('2026-10-10T00:15:00', '23:45'), '2026-10-09T23:45:00', 'and the reverse is the evening before');
  assert.equal(editedStart('2026-10-09T21:00:00', '21:30'), '2026-10-09T21:30:00', 'a same-evening nudge keeps its date');
  assert.equal(editedStart('2026-10-10T01:00:00', '01:30'), '2026-10-10T01:30:00', 'so does a same-night nudge after midnight');
});

test('time edits: a corrected end at or before the start\'s clock time is the next morning', () => {
  assert.equal(editedEnd('2026-10-09T22:40:00', '23:40'), '2026-10-09T23:40:00');
  assert.equal(editedEnd('2026-10-09T23:45:00', '00:45'), '2026-10-10T00:45:00');
  assert.equal(editedEnd('2026-10-09T23:45:00', '23:45'), '2026-10-10T23:45:00', 'equal rolls too — a zero-length set is not a set');
  assert.equal(addDay('2026-12-31', 1), '2027-01-01');
  assert.equal(addDay('2026-03-01', -1), '2026-02-28');
});

test('upload page: the page embeds those helpers by source and reads a moved start back through them', () => {
  for (const fn of [addDay, editedStart, editedEnd]) assert.ok(html.includes(fn.toString()), fn.name);
  assert.ok(html.includes('editedStart(s.start, st)'));
  assert.ok(html.includes('editedEnd(start, en || s.end.slice(11, 16))'), 'the end follows a moved start');
});

test('upload page: the script posts exactly the fields the two adapters read', () => {
  assert.ok(html.includes("post('/api/upload', { festival: d.festival, dates: { first: d.first, last: d.last }, email: d.email, image: imageBody(), update: updateClaim() })"));
  assert.ok(
    html.includes(
      "var body = { festival: d.festival, email: d.email, timezone: zone.value, timezoneAssumed: state.timezoneAssumed, edits: edits, unverifiable: unverifiable, image: imageBody(), update: updateClaim() };",
    ),
  );
  assert.ok(html.includes("post('/api/confirm', body)"));
  assert.ok(html.includes('var UPDATE = null;'), 'on /upload/ there is no update link, so nothing extra goes out');
  assert.ok(html.includes('filename: im.filename, contentType: im.contentType, width: im.width, height: im.height, data: im.data'));
});

test('upload page: a failed request has a plain line and the button comes back', () => {
  assert.ok(html.includes("It didn\\'t go through. Check your signal and try again."));
  assert.ok(html.includes("Something went wrong on my end. Try again in a minute."));
  assert.ok(html.includes("btn.classList.remove('is-loading')"));
});

// ===========================================================================
// Copy and the checklist
// ===========================================================================

test('upload page: no "we", no machinery vocabulary, no exclamation marks, no account words', () => {
  assert.doesNotMatch(text, /\b(we|we're|we've|our|ours|us)\b/i, 'corporate first person');
  const banned = [
    /\bfeeds?\b/i,
    /\bURL\b/,
    /\biCalendar\b/,
    /\bsubscri(be|ption)\b/i,
    /\btranscri(be|bed|ption)\b/i,
    /\bedition\b/i,
    /\bnamespace\b/i,
    /\bverif(y|ied|iable)\b/i,
    /\bdeploy/i,
    /\bAPI\b/,
    /\bJSON\b/,
    /\bcommit\b/i,
    /\bsign up\b/i,
    /\bregister\b/i,
    /\bplease\b/i,
    /\bunfortunately\b/i,
    /\bseamless|effortless|simply\b/i,
    /America\/Los_Angeles/,
    /\bcolour\b/i,
  ];
  for (const re of banned) assert.doesNotMatch(text, re, `${re}`);
  assert.equal(text.includes('!'), false);
});

test('upload page: the footer carries the unofficial line, where the times come from, and the wrong-time link', () => {
  assert.ok(text.includes('Unofficial. Not affiliated with any festival.'));
  assert.ok(text.includes('Anything put on here is checked by the person who put it there, against their own image, before it goes live.'));
  assert.ok(html.includes('Wrong time? <a href="https://github.com/jake-lunde/stage-times/issues">Tell me ↗</a>'));
});

test('upload page: zero third-party requests — every link and script is same-origin', () => {
  const urls = html.match(/https?:\/\/[^\s"'`<)]+/g) ?? [];
  for (const url of urls) {
    assert.ok(
      url.startsWith('https://stagetimes.app') || url === 'https://github.com/jake-lunde/stage-times/issues',
      `unexpected origin on the page: ${url}`,
    );
  }
  assert.ok(html.includes('<script defer src="/_vercel/insights/script.js"></script>'), 'the one approved snippet');
  assert.equal(html.includes("va('event'"), false, 'no custom events on this page');
  assert.ok(html.includes('/assets/fonts/archivo-var-latin.woff2'), 'self-hosted fonts');
});

test('upload page: the checklist — capsules, no shadows or gradients, reduced motion, 320px', () => {
  assert.equal(/box-shadow|linear-gradient/.test(html), false);
  assert.ok(html.includes('prefers-reduced-motion'));
  assert.ok(html.includes('max-width:359px'), 'the narrow-screen rules apply here too');
  assert.match(html, /\.chip\{[^}]*height:32px[^}]*border-radius:16px/, 'chips are 32pt capsules');
  assert.match(html, /\.field input,\.field select\{[^}]*height:52px[^}]*border-radius:8px/, 'fields are the one non-capsule control');
  assert.equal(/#FFF\b|#000\b/i.test(html), false, 'nothing pure white or black');
});

// ===========================================================================
// Where it lands
// ===========================================================================

test('renderSitePages: the upload page is written at /upload/ beside the editions', () => {
  const out = mkdtempSync(join(tmpdir(), 'stage-times-upload-'));
  try {
    const written = renderSitePages(buildFixtureSite([harborDoc()]).site, out);
    assert.ok(written.includes('upload/index.html'));
    const file = join(out, 'upload', 'index.html');
    assert.ok(existsSync(file));
    assert.equal(readFileSync(file, 'utf8'), html, 'byte-identical to a direct render — no clock, no randomness');
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

// ===========================================================================
// The update link (ticket 09)
// ===========================================================================

const pier = buildFixtureSite([pierDoc()]).site.editions[0]!;
const updateHtml = renderUploadPage(pier);
const updateText = visibleText(updateHtml);

function updateScreen(name: Screen): string {
  const re = new RegExp(`<section class="screen"[^>]*data-screen="${name}"[^>]*>[\\s\\S]*?</section>`);
  const m = re.exec(updateHtml);
  assert.ok(m, `screen "${name}" is in the update page`);
  return m![0];
}

test('update link: the screen states the edition it is about to change before any upload', () => {
  const header = /<header>[\s\S]*?<\/header>/.exec(updateHtml)![0];
  assert.ok(header.includes('<h2>Pier Nine <span style="color:var(--ink-soft)">2026</span></h2>'), 'the festival and year, up top');
  const details = updateScreen('details');
  assert.doesNotMatch(details, /^<section[^>]*\bhidden\b/, 'on the first screen, the one that shows');
  const said = visibleText(details).replace(/\s+([.,])/g, '$1').trim();
  assert.ok(
    said.startsWith(
      'A new screenshot replaces every time on stagetimes.app/fan/pier-nine-2026/. Anyone who added a stage gets the new times the next time their calendar app checks.',
    ),
    `before the form, before any image is chosen: ${said}`,
  );
  assert.ok(details.indexOf('data-changing') < details.indexOf('<form'), 'the statement comes before the form');
  assert.match(details, /name="festival"[^>]*value="Pier Nine"/, 'the name is filled in');
  assert.match(details, /name="first"[^>]*value="2026-/, 'and the days');
  assert.ok(updateHtml.includes('var UPDATE = {"editionPath":"fan/pier-nine-2026"};'), 'the script knows which edition');
  assert.ok(updateHtml.includes("secret: location.hash.slice(1)"), 'the secret comes from the fragment only');
});

test('update link: the review says whether the link held, and where the times will land', () => {
  assert.ok(updateHtml.includes("rv.correcting ? 'This replaces the times on ' + address"));
  assert.ok(updateHtml.includes("'That update link didn\\'t match, so this will be a new page: ' + address"));
});

test('update link: taking it down is one destructive button behind one text button, with a way back', () => {
  assert.ok(updateScreen('details').includes('<button class="text-btn" type="button" data-back="remove">Take it down</button>'));
  const remove = updateScreen('remove');
  assert.match(remove, /^<section[^>]*\bhidden\b/);
  assert.ok(remove.includes('<button class="btn btn--tonal btn--danger" type="button" data-remove>Take it down</button>'), 'tonal with red text, not a red pill');
  assert.ok(remove.includes('data-back="details">Keep it</button>'));
  assert.ok(visibleText(remove).includes('Its calendars go empty and the page says it was taken down.'));
  assert.ok(updateHtml.includes("post('/api/remove', { update: updateClaim() })"));
  assert.ok(visibleText(updateScreen('removed')).includes('Taken down'));
});

test('update link: a correction waits for the calendar to change, and does not hand out the link again', () => {
  assert.ok(updateHtml.includes('currentTag(rv.editionPath)'), 'the ETag before confirm');
  assert.ok(updateHtml.includes("(!before || res.headers.get('etag') !== before)"), 'live only once it answers differently');
  assert.equal(updateScreen('publishing').includes('data-update'), false, 'they already hold the link');
  assert.equal(updateScreen('success').includes('data-update'), false);
  assert.ok(visibleText(updateScreen('publishing')).includes('Your new times are saved.'));
});

test('update link: the fresh upload page has no take-down screen', () => {
  assert.equal(html.includes('data-screen="remove"'), false);
  assert.equal(html.includes(' data-remove>'), false);
  assert.equal(html.includes('Take it down'), false);
});

test('update link: both scripts parse', () => {
  for (const page of [html, updateHtml]) {
    const scripts = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]!);
    for (const code of scripts) assert.doesNotThrow(() => new Function(code), 'the embedded script is valid JavaScript');
  }
});

test('update link: same copy rules as the upload page', () => {
  assert.doesNotMatch(updateText, /\b(we|we're|we've|our|ours|us)\b/i);
  for (const re of [/\bfeeds?\b/i, /\.ics\b/, /\bedition\b/i, /\bsubscri(be|ption)\b/i, /\bblocked\b/i, /\bverif(y|ied)\b/i]) {
    assert.doesNotMatch(updateText, re, `${re}`);
  }
  assert.equal(updateText.includes('!'), false);
});

test('update link: a taken-down edition\'s link says so and offers nothing to change', () => {
  const blocked = buildFixtureSite([pierDoc()], { 'fan/pier-nine-2026': { blocked: true } }).site.editions[0]!;
  const page = renderUploadPage(blocked);
  assert.ok(visibleText(page).includes("This page was taken down, so there's nothing left to change here."));
  assert.equal(page.includes('<form'), false);
  assert.equal(page.includes('/api/'), false);
});

test('update link: the site build writes one update page per fan edition, and none for owner editions', () => {
  const out = mkdtempSync(join(tmpdir(), 'stage-times-update-'));
  try {
    const { site } = buildFixtureSite([harborDoc(), pierDoc()]);
    const written = renderSitePages(site, out);
    assert.ok(written.includes('update/fan/pier-nine-2026/index.html'));
    assert.equal(updatePagePath('fan/pier-nine-2026'), 'update/fan/pier-nine-2026');
    assert.equal(readFileSync(join(out, 'update/fan/pier-nine-2026/index.html'), 'utf8'), renderUploadPage(site.editions.find((e) => e.namespace === 'fan')!));
    assert.equal(existsSync(join(out, 'update', 'harbor-lights-2026')), false, 'the owner path is its own');
    assert.equal(updateLink('fan/pier-nine-2026', 's3cret'), 'https://stagetimes.app/update/fan/pier-nine-2026/#s3cret', 'the link lands on that page');
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
