/**
 * The owner's upload flow (ticket 08; ADR-0005): six screens on one static
 * page, driven here through the pages seam — render in, HTML string out.
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

import { ACCEPTED_IMAGE_TYPES, GATE_COPY, MAX_IMAGE_EDGE, MAX_UPLOAD_IMAGES, MIN_IMAGE_EDGE, type Gate } from '../src/publisher.js';
import { renderSitePages } from '../src/pages.js';
import { addDay, confirmStatus, dayLabel, daysLabel, editedEnd, editedStart, festivalDays, GATE_SCREENS, linkStatus, loadingArt, nightOf, ownerFromFragment, ownerLink, percentDone, posterBlock, readAddress, readingStatus, renderUploadPage, REVIEW_ZONES, takeLines, weekdayName, weekendRuns, type Screen } from '../src/upload-pages.js';
import { slugify, weekendsOf } from '../src/transcribe.js';
import { artGround } from '../src/pages.js';
import { STREAM_TYPE } from '../src/publisher-http.js';
import { buildFixtureSite, harborDoc, REPO_ROOT, visibleText } from './helpers.js';

const html = renderUploadPage();
const text = visibleText(html);

/** The markup of one screen's section. */
function screen(name: Screen): string {
  const re = new RegExp(`<section class="screen"[^>]*data-screen="${name}"[^>]*>[\\s\\S]*?</section>`);
  const m = re.exec(html);
  assert.ok(m, `screen "${name}" is in the static markup`);
  return m![0];
}

const SCREENS: Screen[] = ['link', 'details', 'upload', 'review', 'publishing', 'success'];
const ALL_GATES: Gate[] = ['owner', 'details', 'images', 'type', 'size', 'dimensions', 'schedule', 'expired', 'review', 'schema', 'link', 'address', 'unreachable', 'login', 'no-schedule'];

// ===========================================================================
// The screens
// ===========================================================================

test('upload page: every screen is in the static markup, hidden until the owner is known; then the link shows first', () => {
  for (const name of SCREENS) assert.match(screen(name), /^<section[^>]*\bhidden\b/, `${name} shows nothing to a visitor without the bookmark`);
  assert.ok(html.indexOf('if (!OWNER) { location.replace(\'/\'); return; }') < html.indexOf("show('link');"), 'home first, before any screen shows');
  assert.ok(html.indexOf('data-screen="link"') < html.indexOf('data-screen="details"'), 'the front door comes first in the markup too');
});

/** The upload screen's two shapes: one day is the file pill; more is the day rows and one read pill. */
function uploadMode(mode: 'one' | 'many'): string {
  const re = new RegExp(`<div data-${mode}[^>]*>[\\s\\S]*?</div>\\s*(?=<div data-many|</section>)`);
  const m = re.exec(screen('upload'));
  assert.ok(m, `the upload screen has its data-${mode} shape`);
  return m![0];
}

test('upload page: each deciding screen has exactly one primary pill; the wait has none', () => {
  const count = (markup: string) => (markup.match(/btn--primary/g) ?? []).length;
  assert.equal(count(screen('link')), 1);
  assert.equal(count(screen('details')), 1);
  assert.equal(count(uploadMode('one')), 1, 'one day: the file pill');
  assert.equal(count(uploadMode('many')), 1, 'more days: the read pill — the rows are not pills');
  assert.equal(count(screen('upload')), 2, 'and nothing outside the two shapes');
  assert.match(uploadMode('many'), /^<div data-many hidden>/, 'only one shape shows at a time');
  assert.equal(count(screen('review')), 1);
  assert.equal(count(screen('success')), 1);
  assert.equal(count(screen('publishing')), 0, 'nothing to tap while it builds — except copy the link');
});

test('upload page: the details screen asks for the festival and its days, and nothing else', () => {
  const details = screen('details');
  const inputs = details.match(/<input[^>]*>/g) ?? [];
  assert.equal(inputs.length, 4, 'three to fill in, and the schedule link waiting hidden');
  for (const name of ['festival', 'first', 'last', 'link']) {
    assert.ok(inputs.some((i) => i.includes(`name="${name}"`)), `field ${name}`);
  }
  assert.match(details, /<label class="field" data-link hidden><span>Schedule link<\/span><input name="link" type="url"/, 'the link field is there but not asked for');
  assert.match(details, /name="first" type="date"/);
  assert.equal(/email/i.test(details), false, 'no address asked for');
  assert.ok(details.includes('>Next</button>'), 'the one label');
});

test('upload page: one day is one file action that takes images only, and says what to pick', () => {
  const upload = screen('upload');
  const one = uploadMode('one');
  assert.match(one, /<label class="btn btn--primary file-btn"><span>Choose image<\/span><input type="file" accept="image\/\*" name="image"><\/label>/);
  assert.equal((one.match(/<input/g) ?? []).length, 1, 'one control in the one-day shape');
  assert.ok(
    visibleText(upload).includes('The schedule with the times on it, not the lineup. A screenshot from the app or a photo of the poster both work.'),
  );
  assert.ok(html.includes('if (!multiDay()) return sendUpload();'), 'one day posts the moment an image is chosen — no extra step');
  assert.ok(html.includes("if (list.length === 1) body.image = list[0]; else body.images = list;"), 'and goes out as `image`, as it always did');
});

// ===========================================================================
// More than one day (ticket 18)
// ===========================================================================

test('upload page: more days is a row per day — a tappable file row with the day on it, from one template', () => {
  const many = uploadMode('many');
  assert.match(many, /<ol class="days" data-days><\/ol>/, 'the rows are rendered in, one per day offered');
  assert.match(many, /<template id="day-slot">\s*<li class="day" data-slot="">/);
  assert.match(many, /<label class="day-row">[\s\S]*?<input class="vh" type="file" accept="image\/\*" data-slot-input>[\s\S]*?<\/label>/, 'the whole row is the file action');
  assert.ok(many.includes('<span class="mono-cap" data-day></span>'), 'the day, in caption caps');
  assert.ok(many.includes('<span class="day-action" data-action>Choose image</span>'), 'two plain words');
  assert.ok(many.includes('<img alt="" hidden>'), 'the thumbnail, once there is one');
  assert.ok(many.includes('<p class="problem" role="alert" hidden></p>'), 'a rejection has somewhere to land under the row');
  assert.match(many, /<button class="btn btn--primary" type="button" data-read disabled>Read the times<\/button>/, 'one pill, off until an image is chosen');
  assert.ok(visibleText(many).includes('A day with no times yet can be left out.'));
  assert.equal(many.includes('<hr'), false, 'no dividers in a row list');
});

test('upload page: every day has its row from the start, each swappable until the read starts', () => {
  assert.ok(html.includes('var days = festivalDays(d.first, d.last, LIMITS.maxImages);'), 'the days come from the dates typed');
  assert.ok(html.includes(`"maxImages":${MAX_UPLOAD_IMAGES}`), "no more rows than the publisher's own limit");
  assert.ok(html.includes('var offered = state.days.length;'), 'all the days at once, so the shape of the upload is clear before the first image');
  assert.ok(html.includes("$('[data-action]', li).textContent = 'Swap image';"), 'a chosen day can be swapped');
  assert.ok(html.includes('readBtn.disabled = chosen().length === 0;'), 'the read pill waits for the first image and no more');
  assert.ok(html.includes("readBtn.addEventListener('click', function () { if (chosen().length) sendUpload(); });"), 'reading starts on one tap');
  assert.ok(html.includes("? 'Your screenshots' : 'Your screenshot'"), 'the heading agrees with the count');
  for (const fn of [festivalDays, nightOf, dayLabel, daysLabel]) assert.ok(html.includes(fn.toString()), `${fn.name} rides along by source`);
});

test('upload page: the reading state says what is being read and how many, and never how long it has been', () => {
  assert.ok(html.includes("'Reading the times off your image. This could take about a minute.'"));
  assert.ok(html.includes("'Reading the times off your ' + n + ' images. This could take about a minute per image.'"));
  assert.ok(html.includes("(CAN_STREAM ? percentDone(0, n) + '% · ' : '')"), 'the percentage starts at nothing done, and only where progress can arrive');
  assert.ok(html.includes("'Checking the times hold together and saving them. Usually under a minute.'"), 'saving says what it is doing too');
  assert.ok(html.includes("label.textContent = multi ? 'Read the times' : 'Choose image';"), 'the pill comes back as what it was');
});

test('upload page: the elapsed-seconds line is gone from the read and the save — the clock estimates nothing', () => {
  const work = /function startWork\([\s\S]*?\n  \}\n/.exec(html)?.[0] ?? '';
  assert.ok(work.length > 0, 'startWork is in the script');
  assert.doesNotMatch(work, /Date\.now|seconds so far/, 'nothing in the wait reads the clock');
  assert.equal(html.includes("'Still reading.'"), false);
  assert.equal(html.includes("'Still saving.'"), false);
});

test('upload page: the wait is drawn as the beads with no sets yet — a ring per day, on the light red ground', () => {
  const art = loadingArt(3, artGround('#EC300C'));
  assert.equal(art, loadingArt(3, artGround('#EC300C')), 'nothing random');
  assert.equal((art.match(/class="rot"/g) ?? []).length, 3, 'a ring per festival day');
  assert.equal((art.match(/class="bead"/g) ?? []).length, 42, 'fourteen beads a ring');
  assert.equal((loadingArt(1, '#F38A74').match(/class="rot"/g) ?? []).length, 1);
  assert.equal((loadingArt(9, '#F38A74').match(/class="rot"/g) ?? []).length, 7, 'never more rings than the publisher takes images');
  assert.match(art, /^<svg class="art-svg" viewBox="0 0 400 240" preserveAspectRatio="xMidYMid slice" aria-hidden="true"/, 'the stage card\'s art slot, decorative');
  assert.doesNotMatch(art, /linear-gradient|<text/, 'no gradient outside the beads idiom, no words in it');
  assert.ok(html.includes(loadingArt.toString()), 'embedded by source');
  assert.ok(html.includes(`var ART_GROUND = '${artGround('#EC300C')}';`), 'the ground is the action color mixed toward cream, like a stage card');
  assert.match(screen('upload'), /<figure class="loading" data-loading hidden><\/figure>\s*<p class="status" aria-live="polite" hidden><\/p>/, 'above the status line while reading');
  assert.match(screen('review'), /<figure class="loading" data-loading hidden><\/figure>\s*<p class="status" aria-live="polite" data-save-status hidden><\/p>/, 'and while saving');
  assert.match(html, /@media \(prefers-reduced-motion: reduce\)\{[^}]*\}[\s\S]*?\.loading \.bead\{opacity:1\}/, 'under reduced motion the finished ring stays');
});

test('upload page: a source with no web address on it grows the one field for it, and the link goes out with both posts', () => {
  assert.equal(GATE_SCREENS.link, 'details', 'lands on the form');
  assert.ok(html.includes("if (body.gate === 'link') $('[data-link]').hidden = false;"), 'the field appears only then');
  assert.ok(html.includes('if (d.link) body.officialUrl = d.link;'), 'and only goes out when typed');
  assert.ok(html.includes("withImages(typed({ dates: { first: d.first, last: d.last } }))"), 'upload');
  assert.ok(html.includes("withImages(typed({ timezone: zone.value, timezoneAssumed: state.timezoneAssumed, edits: edits, unverifiable: [] }))"), 'confirm');
  assert.ok(html.includes('if (!multiDay() && state.images[0]) sendUpload();'), 'back from the form with the image still chosen, it is read again without another tap');
  assert.ok(visibleText(screen('details')).includes("Where the festival posted the times, since the image doesn't say."));
});

test('upload page: a rejection with nothing reviewed cannot strand the reader on the review screen', () => {
  assert.ok(html.includes("if (to === 'review' && !state.review) to = 'upload';"));
  assert.ok(html.includes("if (!rv) return show(state.via === 'link' ? 'link' : 'upload');"), 'confirm with nothing to confirm goes back to where it came from');
  assert.ok(html.includes("}).catch(function () {\n      return { ok: false, body: { reason: 'Something went wrong on my end. Try again in a minute.' } };\n    }).then(function (r) {"), 'a save that throws still restores the button with a line');
});

test('upload page: a rejection about one image lands under that day\'s row, in the publisher\'s own sentence', () => {
  assert.ok(html.includes("if (to === 'upload' && multiDay() && typeof body.image === 'number' && slotOf(body.image)) {"));
  assert.ok(html.includes('slotProblem(body.image, body.reason);'), 'the sentence, untouched');
  assert.ok(html.includes("if (!r.ok) return land(r.body, 'upload');"), 'from upload');
  assert.ok(html.includes("if (!r.ok) return land(r.body, 'review');"), 'and from confirm');
  assert.ok(html.includes("if (multiDay() && slotOf(slot)) slotProblem(slot, text); else problem('upload', text);"), 'the browser\'s own checks land there too');
});

test('upload page: one post carries every day, so each image gets its share of the byte budget', () => {
  assert.ok(html.includes('function budget() { return Math.floor(LIMITS.postBytes / Math.max(1, state.days.length)); }'));
  assert.ok(html.includes('shrink(img, bytes)'));
  assert.ok(html.includes("'With ' + state.days.length + ' days, each one has to be under ' + mb(bytes) + ' MB.'"), 'a too-big image says why the limit is what it is');
  assert.ok(html.includes("more than I can send in one go."), 'and the total is checked before it goes');
});

test('upload page: the review shows each day\'s own image above that day\'s sets, and every row\'s day matches its image', () => {
  const review = screen('review');
  assert.match(review, /<template id="day-figure">\s*<figure class="source"><img alt="Your image">/, 'the image card comes from a template, once per image');
  assert.ok(html.includes('rv.images.forEach(function (hash, k) {'), 'one section per image');
  assert.ok(html.includes("var daySets = rv.sets.filter(function (s) { return s.image === hash; });"), 'holding the sets read off it');
  assert.ok(html.includes("$('[data-day]', li).textContent = dayLabel(nightOf(s.start));"), 'a 1 AM set is labeled with the night it belongs to');
  assert.ok(html.includes("head.textContent = (w ? 'Weekend ' + w + ' · ' : '') + label;"), 'the day heading over each image, with its weekend when there is more than one');
  assert.ok(html.includes("'Each day against its own image. Check the flagged sets and fix what\\'s off.'"));
  assert.ok(html.includes("'No times were read off this one.'"), 'an image the model read nothing off says so');
  assert.ok(html.includes("swap.textContent = viaLink ? 'Different link' : multi ? 'Swap an image' : 'Different image';"));
});

test('upload page: confirm sends every image back, and the review\'s own list of them', () => {
  assert.ok(html.includes('if (rv.images.length > 1) body.reviewed = rv.images;'));
});

test('day helpers: the days between two dates, capped; the night a start belongs to; the labels', () => {
  assert.deepEqual(festivalDays('2026-10-09', '2026-10-11', 7), ['2026-10-09', '2026-10-10', '2026-10-11']);
  assert.deepEqual(festivalDays('2026-10-09', '2026-10-09', 7), ['2026-10-09'], 'one day is one');
  assert.deepEqual(festivalDays('2026-10-30', '2026-11-01', 7), ['2026-10-30', '2026-10-31', '2026-11-01'], 'across a month end');
  assert.equal(festivalDays('2026-10-01', '2026-10-31', MAX_UPLOAD_IMAGES).length, MAX_UPLOAD_IMAGES, 'never more than the publisher takes');
  assert.equal(nightOf('2026-10-10T01:30:00'), '2026-10-09', '1:30 AM is Friday night');
  assert.equal(nightOf('2026-10-10T06:00:00'), '2026-10-10', '6 AM is the next day');
  assert.equal(nightOf('2026-10-09T22:40:00'), '2026-10-09');
  assert.equal(dayLabel('2026-10-09'), 'FRI');
  assert.equal(dayLabel('2026-10-09', true), 'FRI 9 OCT');
  assert.equal(daysLabel('2026-10-09', '2026-10-09'), 'FRI 9 OCT');
  assert.equal(daysLabel('2026-10-09', '2026-10-10'), 'FRI 9 – SAT 10 OCT', 'one month, named once');
  assert.equal(daysLabel('2026-10-31', '2026-11-01'), 'SAT 31 OCT – SUN 1 NOV');
});

test('upload page: the review screen shows the image beside the sets in the row-list idiom, flags visible, edits inline', () => {
  const review = screen('review');
  assert.match(review, /<figure class="source"><img alt="Your image">/);
  assert.ok(review.indexOf('<select name="timezone">') < review.indexOf('<div id="sets">'), 'the zone, which every time is read in, comes before the sets');
  assert.match(review, /<template id="set-row">\s*<li class="set"/);
  for (const field of ['artist', 'start', 'end']) {
    assert.ok(review.includes(`data-field="${field}"`), `${field} is editable in the row`);
  }
  assert.match(review, /<input type="time"[^>]*data-field="start"/);
  assert.match(review, /<input type="time"[^>]*data-field="end"/);
  assert.equal(review.includes('data-flag="end"'), false, 'a guessed end is not a flag');
  assert.ok(review.includes('<span class="chip" data-flag="low">Look closer</span>'), 'the one flag: the model was unsure of the line');
  assert.match(review, /<p class="small" data-unsure hidden><\/p>/, 'with its few words why');
  assert.ok(review.includes('<button class="btn btn--sm btn--tonal" type="button" data-looks-good>Looks good</button>'), 'and one way to fold it away');
  assert.equal(review.includes('data-unreadable'), false, 'nothing to mark unreadable');
  assert.equal(review.includes('<hr'), false, 'no dividers in a row list');
  assert.ok(review.includes('<template id="set-row">'), 'rows come from one template');
});

test('upload page: "Looks good" folds a flagged row away, and nothing on the review blocks confirm', () => {
  assert.ok(html.includes("var ok = e.target.closest('[data-looks-good]');"));
  assert.ok(html.includes("li.hidden = true;") && html.includes("group.hidden = $$('.set', group).every(function (row) { return row.hidden; });"), 'the row folds, and its stage with it when nothing is left');
  assert.equal(html.includes('btn.disabled = n > 0;'), false, 'confirm is never disabled');
  assert.equal(html.includes('data-unreadable') || html.includes('state.unreadable'), false, 'the unreadable mark is gone from the page (the publisher\'s sentences still ride along, unused)');
  assert.ok(html.includes('unverifiable: []'), 'confirm still answers the field, empty');
});

test("upload page: the browser speaks the publisher's own sentences, injected, never retyped", () => {
  assert.ok(html.includes(`var COPY = ${JSON.stringify(GATE_COPY)};`));
  assert.ok(html.includes('function fill('), 'the placeholder filler rides along by source');
  const pageText = visibleText(html);
  for (const sentence of [GATE_COPY.festival, GATE_COPY.owner, GATE_COPY.notImage]) {
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

test('upload page: the publishing state is honest about the wait', () => {
  const publishing = visibleText(screen('publishing'));
  assert.ok(publishing.includes('Building the page'));
  assert.ok(publishing.includes('Checking again every ten seconds.'), 'the cadence it states is the cadence it polls at');
  assert.ok(html.includes('var POLL_MS = 10 * 1000;'));
  assert.ok(publishing.includes('The times are saved. The page and its calendars take a couple of minutes to build, and this waits for them.'));
  assert.equal(screen('publishing').includes('data-update'), false, 'no update link to hand over');
  assert.ok(html.includes("'/all.ics'"), 'it waits by asking for the calendar itself');
  assert.ok(html.includes("cache: 'no-store'"), 'and never trusts a cached answer');
  assert.ok(html.includes("Still building after five minutes, which is longer than usual."), 'the timeout is a sentence, not a spinner');
});

test('upload page: the success screen shows the page link, and says it is on the homepage', () => {
  const success = screen('success');
  assert.match(success, /<code class="url" data-share><\/code><button class="icon-btn" data-copy aria-label="Copy page link">/);
  assert.equal(success.includes('data-update'), false, 'no update link');
  const t = visibleText(success);
  assert.ok(t.includes('On the homepage now. Add a stage from the page like anyone would, and send the link around.'), 'the confirm was the listing');
  assert.match(success, /<a class="btn btn--primary" data-open>Open the page<\/a>/);
});

test('upload page: the review says where the page will live before anything is confirmed', () => {
  assert.match(screen('review'), /<p class="status" data-address><\/p>/);
  assert.ok(html.includes("var address = ORIGIN.replace("), 'filled from the review\'s edition path');
  assert.ok(html.includes("$('[data-address]').textContent = 'The page will be ' + address;"));
  assert.ok(html.includes("return state.via === 'link' ? readAddress(rv, nameField.value, readYear()) : rv.editionPath;"), 'after screenshots it is what the publisher claimed; after a link it follows the header');
  assert.ok(html.includes("function readYear() { var first = $('[data-read-day]', dayGrid); return first && first.value ? first.value.slice(0, 4) : ''; }"), 'the year is the first day\'s — there is no year field');
});

// ===========================================================================
// The front door is the link (ticket 20)
// ===========================================================================

test('link screen: one decision — the link, one primary pill, and a text button to the screenshots', () => {
  const link = screen('link');
  const inputs = link.match(/<input[^>]*>/g) ?? [];
  assert.equal(inputs.length, 1, 'the link, nothing else typed up front');
  assert.match(link, /<input name="url" type="url" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="https:\/\/" required>/);
  assert.match(link, /<button class="btn btn--primary" type="submit">Read the times<\/button>/, 'the one label, the same words as the read pill');
  assert.match(link, /<button class="text-btn" type="button" data-back="details">Use screenshots<\/button>/, 'today\'s flow is one tap away, as a text button');
  const said = visibleText(link);
  assert.ok(said.includes('The festival’s page with the set times on it, not the lineup.'), 'what to paste, in one line');
  assert.doesNotMatch(said, /\bfestival name\b|\bfirst day\b/i, 'no name, no dates');
  assert.match(link, /<figure class="loading" data-loading hidden><\/figure>\s*<p class="status" aria-live="polite" hidden><\/p>/, 'the same drawn wait as an upload, above the pill');
  assert.ok(link.indexOf('data-loading') < link.indexOf('btn--primary'));
  assert.ok(text.includes('From the festival’s schedule page, or screenshots'), 'the header caption says both doors');
});

test('link screen: the post carries the link and the owner secret, asks for the stream, and lands every answer back here', () => {
  assert.ok(html.includes("post('/api/link', withOwner({ url: url }), function (p) {"), 'the link intent, with the bookmark riding along');
  assert.ok(html.includes("if (p.kind === 'link') { work.say(linkStatus(p)); if (p.step === 'found') work.redraw(p.images); }"), 'the link\'s own steps, and the rings follow the images found');
  assert.ok(html.includes("if (p.kind === 'read') { work.say(readingStatus(p)); work.headliners(p.headliners); }"), 'then the same percentage and headliners as an upload');
  assert.ok(html.includes("function landLink(body) { fail('link', body); show('link'); }"), 'every answer, in the publisher\'s sentence, where the link was typed');
  assert.ok(html.includes('if (!r.ok) return landLink(r.body);'));
  for (const gate of ['address', 'unreachable', 'login', 'no-schedule'] as Gate[]) assert.equal(GATE_SCREENS[gate], 'link', `${gate} → the link screen`);
  assert.ok(html.includes("if (!screens[to]) to = fallback;"), 'a screen this page does not have never strands anyone');
  assert.ok(html.includes("state.details = { festival: rv.festival, first: days[0], last: days[days.length - 1], link: r.body.officialUrl };"), 'what the form would have typed, as read; the link is the official schedule');
  assert.ok(html.includes("var blob = new Blob([bytesOf(im.data)], { type: im.contentType });"), 'the fetched images are held like chosen ones');
  assert.ok(screen('details').includes('<button class="text-btn" type="button" data-back="link">Use a link</button>'), 'and the form offers the way back');
  assert.equal(linkStatus({ step: 'page' }), 'Opening that page.');
  assert.equal(linkStatus({ step: 'found', images: 3 }), 'Found 3 images that could be the schedule. Reading them now.');
  assert.equal(linkStatus({ step: 'found', images: 1 }), 'Found 1 image that could be the schedule. Reading it now.');
  assert.ok(html.includes(linkStatus.toString()), 'embedded by source');
});

test('link review: the name and the days as read sit above the sets as fields, a weekend at a time, with the address under them', () => {
  const review = screen('review');
  assert.match(review, /<h3>Does this look right\?<\/h3>/, 'one heading for both doors');
  assert.equal(html.includes('Check every set'), false, 'the old screenshot heading is gone');
  assert.ok(html.includes("? 'As read off the page. Check the flagged sets and fix what\\'s off.'"));
  const block = /<div class="read" data-as-read hidden>[\s\S]*?<\/template>\s*<\/div>/.exec(review)?.[0] ?? '';
  assert.ok(block.length > 0, 'the header block is in the static markup, hidden until a link');
  assert.match(block, /<input name="name" type="text" autocomplete="off" autocapitalize="words" data-read-name>/, 'the name');
  assert.equal(block.includes('data-read-year'), false, 'no year field: each day carries its year');
  assert.match(block, /<template id="read-weekend">\s*<div class="weekend"><p class="eyebrow" data-weekend hidden><\/p><div class="field-pair" data-weekend-days><\/div><\/div>/, 'a weekend block per run of days, its eyebrow hidden when there is one run');
  assert.ok(html.includes("head.textContent = 'Weekend ' + (w + 1);") && html.includes('head.hidden = runs.length < 2;'), 'the weekend named only when there is more than one');
  assert.match(block, /<template id="read-day">\s*<label class="field"><span data-weekday><\/span><input type="date" data-read-day><\/label>/, 'a date per day read, labeled with its weekday');
  assert.ok(review.indexOf('data-as-read') < review.indexOf('data-address'), 'the address comes right under the fields');
  assert.ok(review.indexOf('data-address') < review.indexOf('<select name="timezone">'), 'then the zone, as today');
  assert.ok(html.includes("readBlock.hidden = !viaLink;"), 'the screenshot flow\'s review is untouched');
  assert.ok(html.includes("$('[data-weekday]', label).textContent = weekdayName(day);"), 'a wrong year shows as the wrong weekday');
  assert.ok(html.includes("nameField.addEventListener('input', updateAddress);"), 'a change to the name changes the address as it is typed');
  assert.ok(html.includes("if (input === inputs[0] && /^\\d{4}-/.test(input.value)) {"), 'the first day\'s year is the festival\'s: moving it moves every other day into that year');
  for (const fn of [slugify, weekdayName, weekendRuns, readAddress]) assert.ok(html.includes(fn.toString()), `${fn.name} rides along by source`);
});

test('weekend runs: the page groups the days exactly as the transcription decides the weekends', () => {
  const acl = ['2026-10-02', '2026-10-03', '2026-10-04', '2026-10-09', '2026-10-10', '2026-10-11'];
  assert.deepEqual(weekendRuns(acl), [acl.slice(0, 3), acl.slice(3)], 'ACL is two weekends');
  assert.deepEqual(weekendRuns(['2026-10-11', '2026-10-09', '2026-10-10']), [['2026-10-09', '2026-10-10', '2026-10-11']], 'one run, sorted');
  assert.deepEqual(weekendRuns(['2026-10-09', '2026-10-09']), [['2026-10-09']], 'once each');
  for (const days of [acl, ['2026-10-09', '2026-10-10', '2026-10-11'], ['2026-04-10', '2026-04-12', '2026-04-14'], ['2026-04-10', '2026-04-11', '2026-04-15', '2026-04-16'], ['2026-12-31', '2027-01-01']]) {
    assert.deepEqual(weekendRuns(days), weekendsOf(days), days.join(' '));
  }
});

test('review: the flagged sets show and the rest of a day fold behind one text button', () => {
  assert.ok(html.includes('function flagged(s) { return s.lowConfidence; }'), 'a line the model was unsure of is the flag — a guessed end is not');
  assert.ok(html.includes("count.textContent = daySets.length + (daySets.length === 1 ? ' set read, ' : ' sets read, ') + (toCheck ? toCheck + ' flagged.' : 'nothing flagged.');"), 'each day counts its sets and its flags');
  assert.ok(html.includes('if (!flagged(s)) { li.hidden = true; folded += 1; }'), 'an unflagged row waits');
  assert.ok(html.includes('group.hidden = !sets.some(flagged);'), 'a stage with nothing flagged waits with it');
  assert.ok(html.includes("more.textContent = daySets.length === 1 ? 'Show the set' : 'Show all ' + daySets.length + ' sets';"), 'one text button per day');
  assert.ok(html.includes("$$('.set[hidden], .stage-group[hidden]', day).forEach(function (el) { el.hidden = false; });"), 'which shows every row of that day');
  assert.ok(html.includes('.set[hidden],.stage-group[hidden]{display:none}'), 'hidden holds against the row styles');
  assert.ok(html.includes("$$('#sets [data-index]').forEach(function (li) {"), 'confirm still reads every row, folded or not');
});

test("review: a guessed end is shown as the calendar will have it, said to be a guess with its length, and moves with the start", () => {
  assert.ok(html.includes("$('[data-field=\"end\"]', li).value = s.end.slice(11, 16);"), 'the guess is in the field');
  assert.ok(html.includes("guess.textContent = ' \\u00b7 No end printed \\u00b7 ' + Math.round((Date.parse(s.end + 'Z') - Date.parse(s.start + 'Z')) / 60000) + ' min guess';"), 'the printed line says so, with the number');
  assert.match(screen('review'), /<span data-guess hidden><\/span>/);
  assert.ok(html.includes("why.textContent = s.unsure;"), "the model's own words under a flagged row");
  assert.ok(html.includes("var end = (start !== s.start || (en && en !== s.end.slice(11, 16))) ? editedEnd(start, en || s.end.slice(11, 16)) : s.end;"), 'an unchanged guess is not sent as an edit, so the publisher moves it with the start');
});

test("review: the zone hint says when the zone is the festival's own, and a change clears it", () => {
  assert.ok(html.includes("? 'Where this festival is held. Change it if that\\'s wrong.'"));
  assert.ok(html.includes('state.timezoneOnRecord = rv.timezoneOnRecord;') && html.includes('state.timezoneOnRecord = state.review.timezoneOnRecord;'), 'read off both answers');
  assert.ok(html.includes('state.timezoneAssumed = false; state.timezoneOnRecord = false; zoneHint();'));
});

test('link review: confirm sends the header\'s name and, when a day was moved, the days — and checks both first', () => {
  assert.ok(html.includes("if (viaLink) { body.festival = name; if (days.join() !== state.days.join()) body.days = days; }"));
  assert.ok(html.includes("if (!name) return problem('review', COPY.festival);"), 'no name, the publisher\'s own sentence');
  assert.ok(html.includes("return problem('review', COPY.days);"), 'a bad or missing date, the publisher\'s own sentence');
  assert.ok(html.includes("swap.setAttribute('data-back', viaLink ? 'link' : 'upload');"), 'the way back from the review is the link screen');
});

test('read helpers: the weekday a date falls on, and the address the header derives', () => {
  assert.equal(weekdayName('2026-10-09'), 'FRIDAY');
  assert.equal(weekdayName('2025-10-09'), 'THURSDAY', 'the same printed date a year off is another weekday — the tell');
  assert.equal(weekdayName('2026-02-29'), '', 'not a date');
  assert.equal(weekdayName(''), '');
  const rv = { festival: 'Low Tide', year: 2026, editionPath: 'low-tide-2026' };
  assert.equal(readAddress(rv, 'Low Tide', '2026'), 'low-tide-2026', 'as read: what the publisher claimed');
  assert.equal(readAddress(rv, ' Low Tide ', '2026'), 'low-tide-2026', 'whitespace is not a change');
  assert.equal(readAddress(rv, 'Low Tide Fest', '2026'), 'low-tide-fest-2026', 'a changed name derives its own path');
  assert.equal(readAddress(rv, 'Low Tide', '2027'), 'low-tide-2027', 'a changed year too');
  assert.equal(readAddress(rv, 'Low Tide!', '2026'), 'low-tide-2026', 'at the root, the way confirm derives it');
});

// ===========================================================================
// The contract with the adapters
// ===========================================================================

test("upload page: every gate's rejection has a screen to land on, and the script carries the same map", () => {
  for (const gate of ALL_GATES) assert.ok(SCREENS.includes(GATE_SCREENS[gate]), `${gate} → ${GATE_SCREENS[gate]}`);
  assert.equal(GATE_SCREENS.details, 'details', 'a typo goes back to the form');
  assert.equal(GATE_SCREENS.owner, 'link', 'a secret that stopped matching lands on the front door');
  for (const gate of ['type', 'size', 'dimensions', 'schedule', 'expired'] as Gate[]) {
    assert.equal(GATE_SCREENS[gate], 'upload', `${gate}: pick another image`);
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

test('upload page: the script posts exactly the fields the adapters read', () => {
  assert.ok(html.includes("post('/api/upload', withOwner(withImages(typed({ dates: { first: d.first, last: d.last } }))), function (p) {"));
  assert.ok(html.includes('var body = withOwner(withImages(typed({ timezone: zone.value, timezoneAssumed: state.timezoneAssumed, edits: edits, unverifiable: [] })));'));
  assert.ok(html.includes('body.festival = d.festival;'), 'the form fields ride on both');
  assert.equal(/email|updateClaim|UPDATE_LINK|updateSecret|\/update\//i.test(html.slice(html.indexOf('<script>'))), false, 'no address and no update link go out, or exist on the page at all');
  assert.ok(html.includes("post('/api/confirm', body, function (p) {"));
  assert.ok(html.includes('filename: im.filename, contentType: im.contentType, width: im.width, height: im.height, data: im.data'));
});

test('upload page: the owner bookmark is read from the fragment, cleared, kept for the tab, and sent with every post — and without it, home', () => {
  assert.equal(ownerLink('a+b/c'), 'https://stagetimes.app/upload/#owner=a%2Bb%2Fc');
  assert.equal(ownerFromFragment(new URL(ownerLink('a+b/c')).hash), 'a+b/c', 'the page reads back what the link carries');
  assert.equal(ownerFromFragment(''), '');
  assert.equal(ownerFromFragment('#something-else'), '');
  assert.equal(ownerFromFragment('#owner=%E0%A4%A'), '', 'a mangled fragment is no secret, not an error');
  assert.ok(html.includes(ownerFromFragment.toString()), 'the page embeds the same reader by source');
  assert.ok(html.includes('var OWNER = ownerFromFragment(location.hash);'));
  assert.ok(html.includes("history.replaceState(null, '', location.pathname + location.search)"), 'cleared from the address bar');
  assert.ok(html.includes("try { if (OWNER) sessionStorage.setItem(OWNER_KEY, OWNER); else OWNER = sessionStorage.getItem(OWNER_KEY) || ''; } catch (e) {}"), 'kept for this tab, so a reload mid-flow still has it; storage that throws is no secret');
  assert.ok(html.includes("if (!OWNER) { location.replace('/'); return; }"), 'nobody else has anything to do here');
  assert.ok(html.includes('function withOwner(body) { body.owner = OWNER; return body; }'), 'every post carries it');
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
  assert.ok(text.includes('Every time here is checked against the festival’s own schedule before it goes live.'));
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
  assert.ok(html.includes('.field[hidden]{display:none}'), 'a hidden field (the schedule link, waiting) really is hidden — the display rule does not beat the attribute');
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

test('owner runbook: documents the bookmark link exactly as the page reads it, and how to rotate it', () => {
  const runbook = readFileSync(join(REPO_ROOT, 'docs', 'owner-runbook.md'), 'utf8');
  assert.ok(runbook.includes(ownerLink('<OWNER_SECRET>').replace('%3C', '<').replace('%3E', '>')), 'the bookmark shape is ownerLink()');
  assert.match(runbook, /## Rotating the owner secret/);
  assert.match(runbook, /scripts\/provision-secrets\.sh/);
  assert.match(runbook, /Redeploy/);
  assert.match(runbook, /replace the bookmark/);
  const wizard = readFileSync(join(REPO_ROOT, 'scripts', 'provision-secrets.sh'), 'utf8');
  assert.ok(wizard.includes('LINK="$SITE/upload/#owner=$OWNER_SECRET"'), 'the wizard prints the same link');
});

// ===========================================================================
// No fan flow left (ADR-0005)
// ===========================================================================

test('upload page: no take-down, no update link, no address field anywhere', () => {
  assert.equal(html.includes('data-screen="remove"'), false);
  assert.equal(html.includes(' data-remove>'), false);
  assert.equal(html.includes('Take it down'), false);
  assert.equal(html.includes('/api/remove'), false);
  assert.equal(html.includes('/update/'), false);
  assert.equal(/type="email"/.test(html), false);
});

test('upload page: the script parses', () => {
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]!);
  for (const code of scripts) assert.doesNotThrow(() => new Function(code), 'the embedded script is valid JavaScript');
});

test('renderSitePages: no update pages are written, for any edition', () => {
  const out = mkdtempSync(join(tmpdir(), 'stage-times-update-'));
  try {
    const written = renderSitePages(buildFixtureSite([harborDoc()]).site, out);
    assert.equal(written.some((p) => p.startsWith('update/')), false);
    assert.equal(existsSync(join(out, 'update')), false);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

// ===========================================================================
// The read, as it happens (ticket 21)
// ===========================================================================

test('stream reader: progress lines go to the listener and the last line is the answer, however the chunks split', () => {
  const body = '{"progress":{"step":"checked","done":0}}\n{"progress":{"step":"read","done":1}}\n{"ok":true,"review":{"slug":"low-tide"}}\n';
  const whole = takeLines('', body, true);
  assert.deepEqual(whole.progress, [{ step: 'checked', done: 0 }, { step: 'read', done: 1 }]);
  assert.deepEqual(whole.answer, { ok: true, review: { slug: 'low-tide' } });

  // Byte by byte: a line split anywhere is held over until its newline arrives.
  let pending = '';
  const progress: unknown[] = [];
  let answer: unknown = null;
  for (const ch of body) {
    const got = takeLines(pending, ch, false);
    pending = got.rest;
    progress.push(...got.progress);
    if (got.answer) answer = got.answer;
  }
  const end = takeLines(pending, '', true);
  assert.deepEqual(progress, whole.progress, 'the same reports, in order');
  assert.deepEqual(answer ?? end.answer, whole.answer, 'the same answer');
});

test('stream reader: an answer with no newline after it still counts once the response ends, and a garbled line is skipped', () => {
  const held = takeLines('', '{"ok":false,"gate":"schedule"}', false);
  assert.equal(held.answer, null, 'not yet — the line may not be finished');
  assert.deepEqual(takeLines(held.rest, '', true).answer, { ok: false, gate: 'schedule' });
  assert.deepEqual(takeLines('', 'not json\n\n{"progress":{"step":"saving"}}\n', true), { progress: [{ step: 'saving' }], answer: null, rest: '' });
});

test('percentage: images done over images sent, floored, clamped, and nothing when there is nothing to count', () => {
  assert.equal(percentDone(0, 3), 0);
  assert.equal(percentDone(1, 3), 33);
  assert.equal(percentDone(2, 3), 66, 'floored: never ahead of what is done');
  assert.equal(percentDone(3, 3), 100);
  assert.equal(percentDone(1, 1), 100);
  assert.equal(percentDone(4, 3), 100, 'never past all of it');
  assert.equal(percentDone(0, 0), 0);
});

test('reading status: says what the last report said — a check cleared, or the sets read so far — behind the percentage', () => {
  assert.equal(readingStatus({ step: 'checked', image: 1, total: 3, done: 1, sets: 5 }), '33% · Image 2 of 3 has set times on it.');
  assert.equal(readingStatus({ step: 'checked', image: 0, total: 1, done: 0, sets: 0 }), '0% · Your image has set times on it.');
  assert.equal(readingStatus({ step: 'read', image: 1, total: 3, done: 2, sets: 8 }), '66% · 8 sets read so far.');
  assert.equal(readingStatus({ step: 'reused', image: 0, total: 3, done: 1, sets: 1 }), '33% · 1 set read so far.');
  assert.equal(readingStatus({ step: 'read', image: 2, total: 3, done: 3, sets: 11 }), '100% · All 11 sets read.');
});

test('confirm status: the review screen names the step confirm is on', () => {
  assert.equal(confirmStatus('checking'), 'Checking the times hold together.');
  assert.equal(confirmStatus('saving'), 'Saving them.');
  assert.equal(confirmStatus('done'), 'Saved.');
  assert.ok(html.includes("if (p.kind === 'confirm') work.say(confirmStatus(p.step));"), 'each confirm report lands on the review screen\'s status line');
  assert.match(screen('review'), /data-save-status/, 'under the art on review');
});

test('headliners: each lands in the center of the art as the stage card prints it — the night and start above the name', () => {
  const block = posterBlock({ artist: 'MUNA', stage: 'Main Stage', night: '2026-10-09', start: '2026-10-09T22:40:00' });
  assert.match(block, /^<g class="lbl">/, 'the stage card\'s label group, styled by the shared .lbl rules');
  assert.match(block, /<text class="eb"[^>]*>FRIDAY · 10:40 PM<\/text>/, 'the eyebrow: the night, then the start');
  assert.match(block, /<text class="disp" x="200" y="\d+" font-size="48" text-anchor="middle" fill="#12181F">MUNA<\/text>/, 'the name, big, ink, centered');
  const late = posterBlock({ artist: 'LATE', stage: 'Main', night: '2026-08-07', start: '2026-08-08T00:30:00' });
  assert.match(late, />FRIDAY · 12:30 AM</, 'a set past midnight keeps the night it closes');
  const long = posterBlock({ artist: 'A VERY LONG NAME FOR A BAND <3', stage: 'S', night: '2026-10-09', start: '2026-10-09T21:00:00' });
  assert.match(long, /font-size="22"/, 'a long name gets smaller, down to the floor');
  assert.match(long, /&lt;3/, 'a name is text, never markup');
  assert.ok(html.includes(posterBlock.toString()), 'embedded by source');
});

test('headliners: they appear one at a time as each image is read, cycling like a stage card, still under reduced motion', () => {
  assert.ok(html.includes('work.headliners(p.headliners);'), 'each read report hands its headliners to the art');
  assert.ok(html.includes("svg.insertAdjacentHTML('beforeend', posterBlock(names[i]));"), 'one name in the center at a time');
  assert.ok(html.includes('var HOLD_MS = 4500;'), 'held about as long as a stage card holds each');
  assert.ok(html.includes("if (!timer && !CALM) timer = setInterval("), 'no cycling under reduced motion — the newest stays');
  assert.match(html, /@media \(prefers-reduced-motion: reduce\)\{[\s\S]*?\.loading \.lbl\{animation:none\}/);
});

test('upload page: the post asks for the stream only where it can read one, and falls back to the whole answer', () => {
  assert.ok(html.includes(`if (stream) headers.Accept = '${STREAM_TYPE}';`), 'the same type the adapters answer to');
  assert.ok(html.includes("var CAN_STREAM = typeof ReadableStream !== 'undefined' && typeof TextDecoder !== 'undefined';"));
  assert.ok(html.includes(`(res.headers.get('content-type') || '').indexOf('${STREAM_TYPE}') === 0`), 'only a streamed answer is read line by line');
  assert.ok(html.includes("readLines(res.body.getReader(), onProgress) : res.json()"), 'anything else is read whole, as it always was');
  for (const fn of [takeLines, percentDone, readingStatus, confirmStatus, posterBlock]) {
    assert.doesNotMatch(fn.toString(), /__name/, `${fn.name} carries no helper the browser lacks`);
  }
  assert.ok(html.includes(takeLines.toString()) && html.includes(percentDone.toString()) && html.includes(readingStatus.toString()) && html.includes(confirmStatus.toString()), 'embedded by source');
  assert.ok(html.includes("work.say(readingStatus(p));"), 'the status line is the last report, and nothing else');
});
