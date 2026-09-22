# Every edition is the owner's; fan publishing is retired

The self-serve expansion (the 2026-09-06 spec, ADR-0001, ADR-0003, tickets 07–10) opened
publishing to anyone with a set-times image, on the bet that there would be more festivals than
one person could keep up with. On 2026-09-22 the owner ruled the other way (vault ruling, "Every
edition is the owner's"): the festivals worth doing are few enough to make every edition himself,
every page should read as official, and the public asks for a festival instead of uploading one.
One fan edition was ever published — ACL 2026, by the owner, testing the public flow.

So **upload, link and confirm require the owner's secret, checked before anything else**
(`notTheOwner()` in `src/publisher.ts`, gate `owner`, HTTP 403). A missing, wrong, empty or
unconfigured secret is refused before a field is judged, a name is resolved, a page is fetched,
a model is asked or a byte is written. `/upload/` sends a visitor without the bookmark home
before a screen shows; the page keeps the secret for the tab in session storage so a reload
mid-flow still has it.

Removed with the fan path, because each existed only for strangers:

- the fan confirm into `data/fan/` and `fan/<key>`, and the suffixed slug a second fan edition
  of a festival-year got;
- the update link — correction and self-removal through `/api/remove`, and the `/update/` page
  per fan edition;
- the listing pull request (the owner's confirm lists in the same commit, as it always did);
- the upload caps and `state/uploads.json` (the secret is now the spend bound);
- the contact address, its hash, and the `uploader` record in `state/published.json`;
- the `edition-published` and `edition-corrected` notifications.

**The fan namespace stays in the build and the schema.** A URL that was ever served keeps
serving (the permanence contract), so `fan/austin-city-limits-music-festival-25-years-2026`
still builds — blocked, with `movedTo: austin-city-limits-2026`, its page pointing at the owner's
edition. Nothing writes `/fan/` again. ADR-0001's rule — an edition never moves between
namespaces — stands for that edition; its premise, strangers claiming names, is gone.

**ADR-0003 was wrong about one thing, and it is fixed here.** It kept the uploader's address out
of the repository by sending it "through the notification … a GitHub issue is not a public
repository file". On a public repository the issues are public too: issue #12 carried the
address in plain text for anyone to read, and the `addressHash` of a guessable address is the
address. The notifier now sends a notice's title and body and nothing else, `Notification` has
no address field, and the `uploader` record is gone from committed state. The rule going
forward: nothing personal goes into a notification, a commit or state.

Changing a published owner edition stays what it was: the watcher's review pull request, or a
hand edit to the YAML (README, "Pushing a schedule change"). A public "something is wrong"
request is a later decision.

What was considered and not done:

- **Keep the fan code dormant behind a flag.** An endpoint that spends money on a stranger's
  request is a liability whether or not the page links to it, and code nobody runs rots
  against the code around it.
- **Keep the update link as the owner's correction tool.** The watcher already corrects watched
  festivals through a reviewed diff; the rest are hand edits for now.

Status: accepted, 2026-09-22. Supersedes the publishing half of ADR-0001 and all of ADR-0003.
