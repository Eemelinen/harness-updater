# Decisions

## D-001 — Triage before the harness loop builds (2026-10-24)

The harness loop's intake built every open retro issue with a feature block. This service puts a
read-only triage session in front of it: the harness intake takes only issues labelled
`updater:accepted` (`retro.intakeLabel`), and the updater refuses to start the loop while that gate
is missing.

## D-002 — Owner-only input (2026-10-24)

The harness repository is public. Only issues opened by the owner's account (the account the loop
drivers use) are triaged, and only the owner's comments reach a session, fenced as data.

## D-003 — Quarantines stay open (2026-10-24)

Closing a quarantine issue as not planned lifts the quarantine. The updater never closes one; a
rejection of a quarantine becomes needs-human.

## D-004 — Own clones, read-only host mount (2026-10-24)

The updater works only in clones in its `/data` volume, which it may reset at will. The host's
project checkouts are mounted read-only at their own path, so absolute trace paths in quarantine
issues resolve, and nothing the updater does can disturb a loop running there.
