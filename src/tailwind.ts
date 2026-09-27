/**
 * Stage Times — the Tailwind step for pages rendered with Subframe components.
 *
 * The Subframe components in src/ui/ (synced by `npx @subframe/cli sync`) are
 * styled with Tailwind classes against the tokens in src/ui/theme.css. This
 * turns a rendered page's HTML into the CSS those classes need, inlined into
 * the page like the rest of its CSS (pages.ts, "Self-contained by rule").
 *
 * - Only the classes the HTML actually uses are generated, found by Tailwind's
 *   own scanner, so a page carries a few KB, not the framework.
 * - No preflight. The hand-written CSS in pages.ts is still the base layer for
 *   every page; a reset under it would change pages that use no components.
 * - Dark mode follows the system, as the rest of the site does. The theme
 *   writes its dark tokens under a `.dark` class; the same block is re-emitted
 *   under `prefers-color-scheme: dark`, read from theme.css so a theme change in
 *   Subframe carries over on the next sync.
 * - Deterministic: same HTML in, same CSS out. Nothing reads a clock.
 *
 * The compiler loads once, at import. That is why this module uses top-level
 * await, and why only the build and the tests import it — never api/.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile, optimize } from '@tailwindcss/node';
import { Scanner } from '@tailwindcss/oxide';

const UI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), 'ui');

/** The theme's `.dark { … }` block, re-scoped to the system setting. */
export function systemDark(themeCss: string): string {
  const m = /^\.dark\s*\{([\s\S]*?)^\}/m.exec(themeCss);
  return m ? `@media (prefers-color-scheme: dark) {\n  :root {${m[1]}}\n}\n` : '';
}

const ENTRY = `@import "tailwindcss/theme.css" layer(theme);
@import "tailwindcss/utilities.css" layer(utilities);
@import "./theme.css";
${systemDark(readFileSync(join(UI_DIR, 'theme.css'), 'utf8'))}`;

const compiler = await compile(ENTRY, { base: UI_DIR, onDependency: () => {} });

/** The CSS for every Tailwind class in `html`, minified. */
export function tailwindFor(html: string): string {
  const candidates = new Scanner({}).scanFiles([{ content: html, extension: 'html' }]);
  return optimize(compiler.build(candidates), { minify: true }).code;
}
