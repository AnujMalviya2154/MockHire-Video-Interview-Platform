# Decision Record — M2: Interview API

## D2.1 — Ownership scoping inside the query, not after it

**Alternatives:** fetch the interview by id, then `if` — check whether the caller is allowed to see it.
**Decision:** the caller's identity is part of the MongoDB filter itself:
`Interview.findOne({ _id: id, interviewer: req.user._id })` and list queries
filter `$or: [{interviewer: me}, {candidate: me}]`.
**Why:** *IDOR-proof by construction.* With fetch-then-check, one forgotten
`if` in any future route leaks another user's data. With scoping in the
query, an unauthorized document simply doesn't exist as far as that request
is concerned — there is nothing to forget. This is the single most
important pattern in this API.

**In short:** "I put authorization into the database query
itself, so an IDOR bug is structurally impossible rather than something a
code review has to catch."

## D2.2 — 404 (not 403) for "exists but not yours"

**Decision:** a non-participant probing someone else's interview id or room
code receives the same `404 Interview not found` as a genuinely missing id.
**Why:** a 403 confirms the resource *exists* — that's an information leak
an attacker can use to enumerate valid ids/room codes. Not-found and
not-yours are deliberately indistinguishable. (Same philosophy as the
anti-enumeration login in M1.)

## D2.3 — Candidate selected by email, id taken from the session

**Decision:** the interviewer schedules by typing the candidate's *email*;
the server resolves it to a user id. The interviewer's own id comes from
`req.user`, never from the request body.
**Why:** two rules from the checklist — "never trust client-provided user
IDs" (a client sending `interviewer: <someone else>` would forge meetings
in another person's name) and good UX (humans know emails, not ObjectIds).
The lookup also enforces the target is a registered **candidate**-role
user, and self-interviews are rejected.

## D2.4 — Feedback privacy shaping (`shapeForViewer`)

**Decision:** one response-shaping function decides what each viewer sees:
the owning interviewer gets full feedback (rating + comments + result); the
candidate gets *only* the result (pass/fail/pending).
**Why:** interviewer comments are candid evaluation notes — exposing them
to candidates would either leak harsh assessments or pressure interviewers
into writing nothing useful. Shaping happens server-side at serialization;
the client never receives the private fields at all (hiding them in the UI
would be mock security).

## D2.5 — Room-code lookup as a separate endpoint with format pre-validation

**Decision:** `GET /interviews/room/:roomCode` validates `^[a-f0-9]{32}$`
*before* any DB query, then applies participant authorization; cancelled
interviews return `410 Gone`.
**Why:** the room code is the join credential (128-bit random), so its
endpoint deserves strict treatment: regex rejection kills malformed/probing
input with zero DB cost; 410 tells legitimate clients "this existed but is
over" without re-opening cancelled meetings. This same participant check is
what the Socket.IO layer (M3) will re-run at join time — REST and realtime
enforce identical rules.

## D2.6 — Status as a tiny state machine

**Decision:** `scheduled → completed` (via feedback) and
`scheduled → cancelled` are the only transitions; feedback on a cancelled
interview → 409, cancelling a completed one → 409.
**Why:** without transition rules, contradictory states are reachable
(a cancelled interview with a pass verdict). The 409s make impossible
states unrepresentable — cheap to enforce now, expensive to clean up later.

## D2.7 — Pagination with capped limit + parallel count

**Decision:** `?page&limit` with limit clamped to 50; items and
`countDocuments` run in `Promise.all`; compound indexes
`{interviewer, scheduledAt}` / `{candidate, scheduledAt}` replace the old
single-field ones.
**Why:** checklist requires pagination (unbounded lists are a DoS vector
and a slow-render bug); the clamp stops `?limit=100000`; parallel count
halves the round-trips; the compound indexes cover both the `$or` filter
side *and* the sort, so the list query never collection-scans. Field-level
`index:true` flags were removed — they'd be duplicate indexes.

## D2.8 — Integration tests as a committed artifact

**Alternatives:** unit tests with a mocked DB; manual Postman checks; no tests.
**Decision:** a self-contained integration suite
(`tests/m2-interviews.test.mjs`) that runs against the real server + real
Atlas cluster with three throwaway users (interviewer, candidate,
outsider), asserts 27 behaviours — every authorization rule, every
validation branch, both privacy shapes — and cleans up after itself.
**Why:** authorization bugs live in the seams between HTTP, middleware and
DB — mocks hide exactly those seams. The "outsider" user exists to prove
scoping (D2.1) and indistinguishability (D2.2) actually hold, not just
compile. No framework dependency keeps the checklist's "minimal
dependencies" rule.
