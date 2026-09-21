/**
 * The upload flow (ticket 08): four screens on one static page, driven here
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

import { ACCEPTED_IMAGE_TYPES, MAX_IMAGE_EDGE, MIN_IMAGE_EDGE, type Gate } from '../src/publisher.js';
import { renderSitePages } from '../src/pages.js';
import { GATE_SCREENS, renderUploadPage, REVIEW_ZONES, updateLink, type Screen } from '../src/upload-pages.js';
import { buildFixtureSite, harborDoc } from './helpers.js';

const html = renderUploadPage();

/** Visible text only: strip script/style, then tags. */
function visibleText(markup: string): string {
  return markup
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ');
}
const text = visibleText(html);

/** The markup of one screen's section. */
function screen(name: Screen): string {
  const re = new RegExp(`<section class="screen"[^>]*data-screen="${name}"[^>]*>[\\s\\S]*?</section>`);
  const m = re.exec(html);
  assert.ok(m, `screen "${name}" is in the static markup`);
  return m![0];
}

const SCREENS: Screen[] = ['details', 'upload', 'review', 'publishing', 'success'];
const ALL_GATES: Gate[] = ['details', 'type', 'size', 'dimensions', 'address-cap', 'daily-cap', 'schedule', 'expired', 'review', 'schema'];

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
  assert.ok(html.includes("One set is still marked as one you can\\'t read. Check it against your image, then confirm."));
  assert.ok(html.includes("sets are still marked as ones you can\\'t read. Check them against your image, then confirm."));
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
  assert.ok(html.includes("'/update/'"), 'the page builds the same shape');
});

// ===========================================================================
// The contract with the adapters
// ===========================================================================

test("upload page: every gate's rejection has a screen to land on, and the script carries the same map", () => {
  for (const gate of ALL_GATES) assert.ok(SCREENS.includes(GATE_SCREENS[gate]), `${gate} → ${GATE_SCREENS[gate]}`);
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
  assert.ok(html.includes("That file isn\\'t an image. A screenshot or a photo of the schedule works."));
  assert.ok(html.includes('there is nothing legible to read the times off.'));
});

test('upload page: the script posts exactly the fields the two adapters read', () => {
  assert.ok(html.includes("post('/api/upload', { festival: d.festival, dates: { first: d.first, last: d.last }, email: d.email, image: imageBody() })"));
  assert.ok(
    html.includes(
      "post('/api/confirm', { festival: d.festival, email: d.email, timezone: zone.value, timezoneAssumed: state.timezoneAssumed, edits: edits, unverifiable: unverifiable, image: imageBody() })",
    ),
  );
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
