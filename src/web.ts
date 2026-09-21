/**
 * Stage Times — the web, as the watcher and the link intent read it.
 *
 * Pure functions over a page someone else published: every image a schedule
 * page shows, what an image's first bytes say about its size, and whether an
 * address is one a request may be sent to at all. Nothing in here opens a
 * socket or resolves a name; the ports do that (`src/ports.ts`), and the
 * watcher (`src/watcher.ts`) and the publisher's link intent (`src/publisher.ts`)
 * decide what to do with what comes back.
 *
 * The address rules exist because the link intent fetches whatever a stranger
 * types. A link never reaches a private, loopback, link-local or otherwise
 * non-public address: the publisher checks the typed link and every address
 * its host resolves to before any request, and the live port checks again at
 * connect time, on every redirect, so a name that resolves one way for the
 * check and another for the request still goes nowhere.
 */

import { BlockList, isIP } from 'node:net';

// ---------------------------------------------------------------------------
// Reading a schedule page
// ---------------------------------------------------------------------------

const IMAGE_HREF_RE = /\.(jpe?g|png|webp|gif)([?#]|$)/i;

/** One attribute's value off a tag's text, whichever way it was quoted. */
function attr(tag: string, name: string): string | undefined {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  if (!m) return undefined;
  return (m[1] ?? m[2] ?? m[3] ?? '').replace(/&amp;/g, '&').trim();
}

/** The candidate a `srcset` names largest — by width, or by density. */
function largestOf(srcset: string): string | undefined {
  let best: { url: string; size: number } | undefined;
  for (const candidate of srcset.split(',')) {
    const [url, descriptor] = candidate.trim().split(/\s+/);
    if (!url) continue;
    const size = descriptor ? parseFloat(descriptor) || 0 : 0;
    if (!best || size > best.size) best = { url, size };
  }
  return best?.url;
}

/**
 * Every image a page shows, as absolute URLs in page order, each once: the
 * share image, CSS backgrounds, `img` and `source` (the largest `srcset`
 * candidate first, then `src`, then a lazy `data-src`), and links straight to
 * an image file. Inline `data:` images are not images anyone posted.
 */
export function imageUrlsIn(html: string, base: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (candidate: string | undefined) => {
    if (!candidate || candidate.startsWith('data:')) return;
    let url: URL;
    try {
      url = new URL(candidate, base);
    } catch {
      return;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
    url.hash = '';
    if (seen.has(url.href)) return;
    seen.add(url.href);
    out.push(url.href);
  };

  const token = /<meta\b[^>]*>|<img\b[^>]*>|<source\b[^>]*>|<a\b[^>]*>|url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s"')]+))\s*\)/gi;
  for (const m of html.matchAll(token)) {
    const tag = m[0];
    if (tag.startsWith('<meta')) {
      const property = attr(tag, 'property') ?? attr(tag, 'name');
      if (property?.toLowerCase() === 'og:image') add(attr(tag, 'content'));
    } else if (tag.startsWith('<img') || tag.startsWith('<source')) {
      const srcset = attr(tag, 'srcset') ?? attr(tag, 'data-srcset');
      if (srcset) add(largestOf(srcset));
      add(attr(tag, 'src'));
      add(attr(tag, 'data-src'));
    } else if (tag.startsWith('<a')) {
      const href = attr(tag, 'href');
      if (href && IMAGE_HREF_RE.test(href.split(/[?#]/)[0] ?? href)) add(href);
    } else {
      add((m[1] ?? m[2] ?? m[3] ?? '').replace(/&amp;/g, '&'));
    }
  }
  return out;
}

export interface ImageHeader {
  width: number;
  height: number;
  contentType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
}

/**
 * What the first bytes of an image say it is and how big it is — enough for
 * the publisher's free gates without decoding a pixel. Null for anything that
 * is not one of the four formats a browser would have uploaded.
 */
export function imageDimensions(bytes: Uint8Array): ImageHeader | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (at: number, n: number) => String.fromCharCode(...bytes.subarray(at, at + n));

  if (bytes.length >= 24 && ascii(1, 3) === 'PNG' && bytes[0] === 0x89 && ascii(12, 4) === 'IHDR') {
    return { width: view.getUint32(16), height: view.getUint32(20), contentType: 'image/png' };
  }
  if (bytes.length >= 10 && ascii(0, 4) === 'GIF8') {
    return { width: view.getUint16(6, true), height: view.getUint16(8, true), contentType: 'image/gif' };
  }
  if (bytes.length >= 30 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
    const chunk = ascii(12, 4);
    if (chunk === 'VP8X') {
      const w = bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16);
      const h = bytes[27]! | (bytes[28]! << 8) | (bytes[29]! << 16);
      return { width: w + 1, height: h + 1, contentType: 'image/webp' };
    }
    if (chunk === 'VP8L' && bytes[20] === 0x2f) {
      const b = view.getUint32(21, true);
      return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1, contentType: 'image/webp' };
    }
    if (chunk === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
      return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff, contentType: 'image/webp' };
    }
    return null;
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let at = 2;
    while (at + 9 < bytes.length) {
      if (bytes[at] !== 0xff) return null;
      const marker = bytes[at + 1]!;
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
        at += 2;
        continue;
      }
      const length = view.getUint16(at + 2);
      const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) return { height: view.getUint16(at + 5), width: view.getUint16(at + 7), contentType: 'image/jpeg' };
      if (marker === 0xda || marker === 0xd9) return null;
      at += 2 + length;
    }
    return null;
  }
  return null;
}

/** A fetched image, as the page served it. */
export interface FetchedImage {
  bytes: Uint8Array;
  /** The `Content-Type` the server sent, if any. The bytes have the last word. */
  contentType?: string;
}

/** The last path segment of an image's URL, for the log. Never a path. */
export function filenameOf(url: string): string {
  try {
    const last = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).at(-1) ?? '');
    return last || 'image';
  } catch {
    return 'image';
  }
}

// ---------------------------------------------------------------------------
// Where a request may go
// ---------------------------------------------------------------------------

/**
 * Every range a request from the publisher must never reach: this network,
 * private networks, carrier-grade NAT, loopback, link-local (the cloud
 * metadata address among them), documentation and benchmark ranges, multicast
 * and reserved space — and, for IPv6, unique-local, link-local, multicast, and
 * every form that embeds an IPv4 address, since the embedded one could be any
 * of the above.
 */
const NOT_PUBLIC = (() => {
  const v4: [string, number][] = [
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.0.0.0', 24],
    ['192.0.2.0', 24],
    ['192.88.99.0', 24],
    ['192.168.0.0', 16],
    ['198.18.0.0', 15],
    ['198.51.100.0', 24],
    ['203.0.113.0', 24],
    ['224.0.0.0', 4],
    ['240.0.0.0', 4],
  ];
  const v6: [string, number][] = [
    ['::', 96], // unspecified, loopback, and the old IPv4-compatible form
    ['::ffff:0:0', 96], // IPv4-mapped
    ['64:ff9b::', 96], // NAT64
    ['64:ff9b:1::', 48],
    ['100::', 64], // discard
    ['2001::', 23], // IETF protocol assignments, Teredo among them
    ['2001:db8::', 32], // documentation
    ['2002::', 16], // 6to4
    ['fc00::', 7], // unique local
    ['fe80::', 10], // link-local
    ['fec0::', 10], // site-local, deprecated
    ['ff00::', 8], // multicast
  ];
  // Two lists, because one list checks an IPv4 address against its IPv6 rules
  // too, as `::ffff:a.b.c.d` — which the mapped range would refuse every time.
  const lists = { ipv4: new BlockList(), ipv6: new BlockList() };
  for (const [net, prefix] of v4) lists.ipv4.addSubnet(net, prefix, 'ipv4');
  for (const [net, prefix] of v6) lists.ipv6.addSubnet(net, prefix, 'ipv6');
  return lists;
})();

/** Is this IP address one anyone on the internet could reach? Anything that is not an address is not. */
export function isPublicAddress(address: string): boolean {
  const bare = address.replace(/^\[|\]$/g, '').replace(/%.*$/, '');
  const family = isIP(bare);
  if (family === 4) return !NOT_PUBLIC.ipv4.check(bare, 'ipv4');
  if (family === 6) return !NOT_PUBLIC.ipv6.check(bare, 'ipv6');
  return false;
}

/** Names that only ever mean a machine on the same network. */
const LOCAL_NAME_RE = /(^|\.)(localhost|local|localdomain|internal|intranet|lan|home|corp|private|home\.arpa)$/;

/**
 * The link someone typed, as a URL a request may be sent to — or null when it
 * is not a public http(s) web address. A bare `festival.com/schedule` is read
 * as https. Refused, with no request made: another scheme, a user name or
 * password in the link, an IP address that is not public, and a host name
 * that only means something on a local network (`localhost`, `*.local`, a
 * name with no dot in it). A name that merely resolves somewhere private is
 * the resolver's to catch — this sees only the text.
 */
export function publicLink(typed: string): URL | null {
  const text = typed.trim();
  if (text === '' || /\s/.test(text)) return null;
  let url: URL;
  try {
    url = new URL(text.includes('://') ? text : `https://${text}`);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username !== '' || url.password !== '') return null;
  const host = hostOf(url);
  if (host === '') return null;
  if (isIP(host)) {
    if (!isPublicAddress(host)) return null;
  } else if (!host.includes('.') || LOCAL_NAME_RE.test(host) || /^[\d.]+$/.test(host)) {
    return null;
  }
  url.hash = '';
  return url;
}

/** A URL's host name as a resolver takes it: lowercase, no brackets, no trailing dot. */
export function hostOf(url: URL): string {
  return url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
}

// ---------------------------------------------------------------------------
// What a page answered
// ---------------------------------------------------------------------------

/** One page as the web answered it, after any redirects. */
export interface WebPage {
  /** The HTTP status of the last answer. */
  status: number;
  /** Where the page ended up, after redirects. Relative image links resolve against it. */
  url: string;
  /** The `Content-Type` it was served with, or empty. */
  contentType: string;
  /** The body as text. */
  html: string;
}

/** A path that is somebody's sign-in screen rather than a schedule. */
const LOGIN_PATH_RE = /(^|\/)(login|log-in|signin|sign-in|sign_in|logon|sso|auth|authenticate|oauth|accounts?\/login)(\/|\.|$)/i;
const PASSWORD_FIELD_RE = /<input\b[^>]*\btype\s*=\s*["']?password\b/i;

/**
 * Does this answer ask for a login before it shows anything? A 401 always
 * does; otherwise a page that landed on a sign-in path, or that carries a
 * password field, is a login wall whatever its status — a 403 without either
 * is a refusal, not a login.
 */
export function isLoginWall(page: WebPage): boolean {
  if (page.status === 401 || page.status === 407) return true;
  let path = '';
  try {
    path = new URL(page.url).pathname;
  } catch {
    path = '';
  }
  return LOGIN_PATH_RE.test(path) || PASSWORD_FIELD_RE.test(page.html);
}

/** Is this answer a web page at all — HTML, or a server that did not say? */
export function isHtml(page: WebPage): boolean {
  return page.contentType === '' || /html|xml/i.test(page.contentType);
}
