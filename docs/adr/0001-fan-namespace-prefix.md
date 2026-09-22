# Fan-uploaded editions live under `/fan/`; the root namespace is reserved for the owner

Feed URLs are permanent, so whoever first claims `stagetimes.app/coachella-2027/` holds it
forever, correct or not. Opening uploads to the public therefore forced a choice: one flat
namespace where a stranger can burn a canonical name with a bad transcription, or a split. We
split. Owner-published editions sit at the root; every fan-published edition sits under `/fan/`
(`stagetimes.app/fan/coachella-2027/`) and stays there even after the owner lists it. The cost
is a slightly longer link for fan editions. The gain is that the names people will actually
search for stay owner-curated, and a fan link honestly says what it is to whoever receives it.

Status: accepted, 2026-09-06. Publishing half superseded by ADR-0005 (2026-09-22): nobody but the
owner publishes, and nothing writes `/fan/` again; the one fan edition keeps its URL under this rule.
