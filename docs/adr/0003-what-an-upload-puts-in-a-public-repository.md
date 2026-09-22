# A fan upload commits hashes, never the uploader's address

The publisher commits straight to `main`, and this repository is public. Everything an upload
writes is therefore permanent and readable by anyone, including by git history after a deletion —
which makes "what goes in the commit" a decision rather than a detail. Two pieces of an upload are
personal: the contact address, and the update-link secret that is the uploader's only claim on
their edition.

Neither is committed. `state/published.json` keeps `addressHash` (SHA-256 of the lowercased
address) and `secretHash`, and `state/uploads.json` keeps the same address hash for the per-address
cap. The hashes are enough for everything the code has to do: recognize a repeat uploader within
the hour, and check a secret someone presents. The address itself reaches the owner exactly once,
in the notification that announces the edition, because the owner is the only person who ever needs
to reach an uploader — and a GitHub issue is not a public repository file. The secret is returned
once in the confirm response and never stored at all.

The cost is that the owner cannot look an uploader up from the repository; he has to find the
notification. That is the right trade: a published address is unfixable, and the notification is
searchable.

**The stored source image goes in the repository, for now.** The image is named by its content
hash and the publisher emits it as a separate `images` entry in the commit rather than as a file,
so an adapter can route it somewhere else without touching the seam. Today it is not routed
anywhere else: `source/images/<hash>.<ext>` is committed to `main` alongside the edition. The cost
is that a rights-holder block can delete the file from the tree but not from history — this
repository is public, and git keeps every commit. The owner accepted that cost on 2026-09-21
(vault ruling: "Source images commit to the public repo for now") so the first real upload could
happen; the takedown runbook says what a block can and cannot do to an image. A private store is
still the intended end state, and the seam is already shaped for it. Revisit before the first
rights-holder request, or when a festival objects to the image rather than the times.

Status: accepted, 2026-09-13; image store settled for now by the owner, 2026-09-21. Superseded by
ADR-0005 (2026-09-22): no address is collected any more, and the premise that a GitHub issue is
private was wrong — on a public repository it is public, and issue #12 showed an address.
