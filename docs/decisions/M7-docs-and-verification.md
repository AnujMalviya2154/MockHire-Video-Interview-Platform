# M7 — Documentation & Final Verification

**Commit:** `docs: README with setup, architecture and security notes`

The final milestone. No production code changes — M7 is the README, the
closing verification pass, and this record. The PRD's v1 acceptance
criteria were exercised across M5/M6 in a real browser; this milestone
re-ran every automated gate against the finished tree.

---

## D7.1 — The README is an argument, not a manual

**Decision:** the README leads with what the project *is* and the three
or four decisions that make it interesting (P2P media the server cannot
see, one HTTP server for REST + sockets sharing cookie auth, bind-first
startup with a readiness contract, DB-fresh role checks with real token
revocation) — and links to `docs/` for everything argued at length.

**Alternatives considered:** (a) an exhaustive README duplicating
`ARCHITECTURE.md` — two copies of the same content drift apart, and the
long one stops being read; (b) a minimal install-only README — wastes the
one page a recruiter is guaranteed to look at.

**Why:** the audience for this repo is someone deciding in ninety seconds
whether the author can think. Setup must work verbatim (it was run
verbatim to check), but the differentiating content is the reasoning —
so the README samples it and points at the full record. The docs tree
already tells the deep story; the README's job is to make someone want
to read it.

**Interview one-liner:** "The README is written for the ninety-second
reader; `docs/` is written for the ninety-minute one. Neither duplicates
the other."

## D7.2 — Security posture stated honestly, exception included

**Decision:** the README's security section links the PRD threat table to
the implemented controls — and names the one open exception (the
react-router advisory, D6c.6) instead of omitting it.

**Why:** a reader who runs `npm audit` in `client/` will see the finding
in ten seconds. A README that claims a clean bill while the audit says
otherwise reads as either careless or dishonest — the two impressions the
security-first posture exists to prevent. Naming it, with the
reachability argument and a revisit trigger, converts a liability into
evidence of judgment.

**Interview one-liner:** "I documented the vulnerability my own audit
gate flagged. Hiding it would have taken one deleted line; explaining it
took a paragraph and says more."

## D7.3 — Tests documented as integration-by-design

**Decision:** the README states plainly that the suites run against a
live server and a real database, self-cleaning, rather than presenting
mocked unit coverage.

**Why:** the risks this project carries — cookie flows, socket handshake
auth, room authorization, IDOR scoping — live at the integration
boundary. A mocked test of `requireAuth` proves the mock; 52 assertions
against the real stack prove the system. Saying so preempts the "why no
unit tests?" question with the actual reasoning.

**Interview one-liner:** "Everything worth breaking here breaks at a
boundary — so the tests live at the boundaries."

---

## Final verification (all gates, finished tree)

| Gate | Result |
|---|---|
| M2 suite (auth, scheduling, IDOR, feedback privacy) | **27 passed, 0 failed** |
| M3 suite (socket auth, room authorization, rate limits) | **22 passed, 0 failed** |
| M6c suite (binds without DB, survives DB outage) | **3 passed, 0 failed** |
| Client production build | **clean** — 93 modules |
| `npm audit --omit=dev`, server | **0 vulnerabilities** |
| `npm audit --omit=dev`, client | 1 documented exception (D6c.6), no others |
| Setup instructions | run verbatim on this machine |
| Atlas test data | zero test-domain users remaining |

v1 acceptance (PRD §M7): two browsers on one machine — register both
roles, schedule, join the same room, see/hear each other, chat, share
screen, co-edit code, submit feedback, candidate sees the result;
an outsider with the room URL is refused. Exercised end-to-end in real
browsers during M5/M6 verification; every server-side control backing it
is covered by the suites above.
