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

**Still open: where the stored source image goes.** The image is named by its content hash and the
publisher emits it as a separate `images` entry in the commit rather than as a file, so an adapter
can route it somewhere else without touching the seam. It has to be routed somewhere else: the
takedown runbook says a rights-holder block deletes the stored image, and committing it to a public
repository makes that impossible — history keeps it. A private store is needed before the first
real upload.

Status: accepted, 2026-09-13, except the image-store question, which is the owner's.
