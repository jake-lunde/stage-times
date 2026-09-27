# React is the build-time template language; the components come from Subframe

The pages were template strings in `src/pages.ts` and `src/upload-pages.ts`, styled by one
hand-written stylesheet. The owner wants the design in Subframe and the site's code to stay one
loop (2026-09-27): a component changed in Subframe should reach the site as a synced diff, not
be carried across by hand. The Subframe CLI syncs React components only, so the pages move to
React — **at build time only**.

- **React renders static HTML in the build** (`renderToStaticMarkup`) and nothing else. No
  hydration, no client bundle: a page ships the same small inline scripts it did before. A page
  loaded on festival wifi at 2am must not start shipping a framework.
- **Components live in `src/ui/`**, written by `npx @subframe/cli@latest sync --all`
  (`.subframe/sync.json`). Don't edit a synced file by hand; change the component in Subframe
  and sync. A wrapper that needs logic goes in the component's `index.tsx`, with sync disabled
  for that file.
- **Tailwind runs in the build** (`src/tailwind.ts`). It emits only the classes a page's HTML
  uses, inlined into the page like the rest of its CSS, with no preflight, so the hand-written
  base stays the base. The theme's dark tokens, written under a `.dark` class, are re-emitted
  under `prefers-color-scheme: dark`, because the site follows the system setting.
- **The page owns layout, the component owns the look.** The page's unlayered CSS sets a
  component's size and position in the page (the shelf, the grid). It beats the component's
  Tailwind sizing because Tailwind's utilities sit in a cascade layer. Fill, type, radius,
  hover and press come from Subframe.

Moved so far: the landing page, with the Festival Card. The subscribe, removed and upload pages
are still template strings and move one at a time. The upload flow's client script may become
a real React island later. That would be a separate decision, because it would ship JavaScript.

Cost: the landing page grew about 1.5 KB gzipped (the Tailwind class names on each card, and
their CSS). `tailwindcss`, `@tailwindcss/node` and `@tailwindcss/oxide` are build-only; nothing
in `api/` imports them.
