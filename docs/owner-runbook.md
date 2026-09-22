# Owner runbook: the bookmark

Every edition is the owner's (ADR-0005). The owner publishes through the upload, review and
confirm screens at `/upload/`, recognized by a secret carried in a bookmarked link; nobody else
can use them. Vocabulary is `CONTEXT.md`. This page is the procedure.

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
- The page reads it once, **clears it from the address bar**, keeps it in the tab's session
  storage so a reload mid-flow still has it, and sends it as `owner` with every post
  (`/api/link`, `/api/upload`, `/api/confirm`). Closing the tab forgets it.
- Without it the page sends the visitor home before a screen shows.
- The publisher checks it against `OWNER_SECRET` in constant time (`ownerMatches()` in
  `src/secrets.ts`, through the owner port in `src/ports.ts`) **before anything else**. A wrong,
  stale, empty or missing secret — or a deployment with none set — is refused: no field is
  judged, no page fetched, no model asked, nothing written. The page shows "Only I add festivals
  here." on the first screen; that means the bookmark is stale.

## What the confirm does

One commit to `main`:

- the YAML goes to `data/<festival>-<year>.yaml` with `namespace: owner`, and the log to
  `source/<festival>-<year>/TRANSCRIPTION.md`;
- the stored source images go to `source/images/<hash>.<ext>`;
- the edition is recorded in `state/published.json` under `<festival>-<year>` with
  **`listed: true`** in the same commit — your tap is the approval;
- no pull request and no notification: nothing machine-initiated happened.

An edition that already exists at that path is **refused**, never replaced and never suffixed.
To change a published edition's times, merge the watcher's review pull request when there is
one, or edit its YAML (README, "Pushing a schedule change").

**Stage ids are permanent from this commit** — and the commit deploys. The review screen does
not let you rename a stage, so when the ids a reading derives are not ones you want forever
(`tito-s-handmade-vodka-weekend-1`), build the edition locally instead: transcribe the stored
readings with the stages you picked, each carrying `read_as:` so the watcher maps its readings
back onto them (README, the watcher). ACL 2026 was made this way.

## Rotating the owner secret

Rotate when the bookmark may have leaked (a shared screen, a synced browser you no longer
control) or on whatever schedule you like. The secret is the only thing between a stranger and
a model call on your key.

1. `scripts/provision-secrets.sh` — say yes at "OWNER_SECRET already exists on Vercel. Rotate
   it?". It mints a new secret, sets it for production and preview, prints the new link, and
   copies it to your clipboard.
2. Save the new link in 1Password and **replace the bookmark** on every device.
3. **Redeploy.** Vercel reads environment variables at deploy time; until a new deployment is
   live, the old secret still works and the new one does not. The wizard's last stage offers
   the push or a redeploy, then polls `POST /api/health`, which says `owner: true` once the
   new secret is recognized.
4. The old bookmark is now refused on its first post.

After a suspected leak, also check `state/published.json` in `git log` for editions you did not
publish. Block any you find ([takedown-runbook.md](./takedown-runbook.md)); never delete one.
