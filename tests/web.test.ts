/**
 * The web as the link intent reads it: which addresses a request may go to,
 * and what a page that asks for a login looks like. Pure functions, no
 * network — the live port's own checks are in tests/ports.test.ts.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { isLoginWall, isPublicAddress, publicLink, type WebPage } from '../src/web.js';

test('a private, loopback, link-local or reserved address is not public, in either family', () => {
  for (const address of [
    '10.0.0.1',
    '172.20.1.1',
    '192.168.1.10',
    '127.0.0.1',
    '169.254.169.254',
    '100.64.1.1',
    '0.0.0.0',
    '224.0.0.1',
    '::1',
    '::',
    'fe80::1',
    'fd00::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '64:ff9b::a00:1',
    'not an address',
  ]) {
    assert.equal(isPublicAddress(address), false, `${address} should not count as public`);
  }
  for (const address of ['8.8.8.8', '93.184.216.34', '2606:4700::1111', '2001:4860:4860::8888']) {
    assert.equal(isPublicAddress(address), true, `${address} should count as public`);
  }
});

test('a typed link is a public http(s) web address or nothing, and a bare domain reads as https', () => {
  assert.equal(publicLink('aclfestival.com/lineup')?.href, 'https://aclfestival.com/lineup');
  assert.equal(publicLink('  https://lowtide.example/schedule#friday ')?.href, 'https://lowtide.example/schedule');
  assert.equal(publicLink('http://lowtide.example/')?.href, 'http://lowtide.example/');

  for (const typed of [
    '',
    'not a link at all',
    'ftp://lowtide.example/',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'mailto:sam@example.com',
    'https://sam:hunter2@lowtide.example/',
    'http://localhost:3000/',
    'http://printer.local/',
    'http://intranet/',
    'http://127.0.0.1/',
    'http://0x7f.1/',
    'http://2130706433/',
    'http://[::1]/',
    'http://[::ffff:10.0.0.1]/',
    'http://10.1.2.3/schedule',
    'http://169.254.169.254/latest/meta-data/',
  ]) {
    assert.equal(publicLink(typed), null, `${JSON.stringify(typed)} should be refused`);
  }
});

function page(overrides: Partial<WebPage>): WebPage {
  return { status: 200, url: 'https://lowtide.example/schedule', contentType: 'text/html', html: '<p>Schedule</p>', ...overrides };
}

test('a login wall is a 401, a sign-in path, or a password field; a bare 403 is a refusal, not a login', () => {
  assert.equal(isLoginWall(page({ status: 401 })), true, '401');
  assert.equal(isLoginWall(page({ url: 'https://www.instagram.com/accounts/login/?next=/lowtide/' })), true, 'instagram login redirect');
  assert.equal(isLoginWall(page({ url: 'https://lowtide.example/signin' })), true, 'signin path');
  assert.equal(isLoginWall(page({ html: '<form><input name="p" type="password"></form>' })), true, 'password field');
  assert.equal(isLoginWall(page({})), false, 'a plain page');
  assert.equal(isLoginWall(page({ status: 403 })), false, 'a bare 403');
  assert.equal(isLoginWall(page({ url: 'https://lowtide.example/authors/sam' })), false, 'a path that only starts like auth');
});
