# Owner runbook: the bookmark and the listing pull request

The **owner** publishes through the same upload, review and confirm screens as any uploader,
recognized by a secret carried in a bookmarked link. Vocabulary is `CONTEXT.md`; the product
decisions are in the vault spec (self-serve editions, 2026-09-06, "The owner path"). This page
is the procedure.

## The bookmark

```
https://stagetimes.app/upload/#owner=<OWNER_SECRET>
```

`OWNER_SECRET` is the Vercel environment variable of that name (production and preview), 32
random bytes in hex, minted by `scripts/provision-secrets.sh`. It lives in 1Password and in
your bookmark; nowhere else. The shape is `ownerLink()` in `src/upload-pages.ts`.

How it works:

- The secret rides in the **fragment** (after `#`), which a browser never sends to a server, so
  it never lands in a request log.
- The page reads it once, **clears it from the address bar**, and sends it as `owner` with both
  posts (`/api/upload`, `/api/confirm`). Reloading mid-flow drops it; open the bookmark again.
- The publisher checks it against `OWNER_SECRET` in constant time (`ownerMatches()` in
  `src/secrets.ts`, through the owner port in `src/ports.ts`). A wrong, stale, empty or missing
  secret — or a deployment with none set — is treated exactly as no secret: the upload is a
  fan's, and nothing in the response says a secret was tried.

**Check the review screen.** It says where the page will live. With the owner secret it reads
`stagetimes.app/<festival>-<year>/`; without it, `stagetimes.app/fan/<festival>-<year>/`. If
you see `/fan/`, your bookmark is stale — stop, and fix the bookmark before you confirm. A fan
edition can never move to the root afterwards (ADR-0001).

## What the owner's confirm does

One commit to `main`, same as a fan's, except:

- the YAML goes to `data/<festival>-<year>.yaml` with `namespace: owner`, and the log to
  `source/<festival>-<year>/TRANSCRIPTION.md`;
- the edition is recorded in `state/published.json` under `<festival>-<year>` with
  **`listed: true`** in the same commit — your tap is the approval;
- no listing pull request and no notification: nothing machine-initiated happened.

The success screen still hands you an update link, as it would anyone — but keep it as a
receipt, not a tool. The update link (ticket 09) corrects and takes down fan editions only, and
its page is written for fan editions only, so an owner edition's link has nowhere to land.

An owner edition that already exists at that path is **refused**, never replaced and never
suffixed — replacing one is a correction, not a new upload. To change an owner edition's times,
edit its YAML (README, "Pushing a schedule change").

The upload caps (3 per address per hour, 20 a day across everyone) apply to you too.

## Listing a fan edition

Every fan confirm does two machine-initiated things, both of which land in your GitHub inbox:

1. an **issue** labeled `edition-published` — the set count, the images, the uploader's address
   (the only place it exists; ADR-0003), and the page link;
2. a **pull request** titled `List <Festival> <Year>` from branch `list/fan/<festival>-<year>`.
   Its body has the page link and the set count. Its diff is one line in
   `state/published.json`: that edition's `"listed": false` becomes `true`.

Open the page link, look at it, and **merge the pull request from the GitHub app** to list it.
The next deploy puts it on the homepage; no feed byte changes, so no `publishedAt` bump is
needed. To decline, close the pull request. It stays uploader-verified at its own link and
appears nowhere on the site.

The branch starts at the publish commit, so the diff stays that one line whatever lands on
`main` in between. If the edition is blocked before you merge, merging still sets `listed`, and
the build still treats a blocked edition as unlisted.

**If the pull request did not open**, the issue says "The listing pull request could not be
opened … list it by hand" with GitHub's answer — usually the token lacks *Pull requests:
read and write*. The edition is published either way. To list by hand, make the same one-line
edit to `state/published.json` on `main` and push.

## Rotating the owner secret

Rotate when the bookmark may have leaked (a shared screen, a synced browser you no longer
control) or on whatever schedule you like.

1. `scripts/provision-secrets.sh` — say yes at "OWNER_SECRET already exists on Vercel. Rotate
   it?". It mints a new secret, sets it for production and preview, prints the new link, and
   copies it to your clipboard.
2. Save the new link in 1Password and **replace the bookmark** on every device.
3. **Redeploy.** Vercel reads environment variables at deploy time; until a new deployment is
   live, the old secret still works and the new one does not. The wizard's last stage offers
   the push or a redeploy, then polls `POST /api/health`, which says `owner: true` once the
   new secret is recognized.
4. The old bookmark now publishes as a fan, silently — which is why the review screen check
   above matters.

After a suspected leak, also check `state/published.json` in `git log` for root-namespace
editions you did not publish. Block any you find ([takedown-runbook.md](./takedown-runbook.md));
never delete one.
