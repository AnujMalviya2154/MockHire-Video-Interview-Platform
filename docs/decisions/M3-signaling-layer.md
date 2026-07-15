# Decision Record — M3: Signaling Layer

## D3.1 — Socket.IO attached to the same HTTP server as Express

**Alternatives:** a separate websocket process/port; a raw `ws` server.
**Decision:** `attachSocket(httpServer)` — one process, one port, one origin.
**Why:** the decisive reason is *auth*: sharing the origin means the
browser automatically sends the same httpOnly JWT cookie with the websocket
handshake. No token-in-query-string (which leaks into logs), no separate
auth system. Socket.IO over raw `ws` buys rooms, acks, and reconnection
handling we'd otherwise hand-roll.

## D3.2 — Handshake-level authentication via the shared verify helper

**Alternatives:** authenticate on each event; trust a userId the client sends.
**Decision:** an `io.use()` middleware runs `verifyTokenFromCookieHeader`
(built in M1) once per connection; failures never complete the handshake.
The socket then carries a server-verified `socket.user` for its lifetime.
**Why:** one code path for REST and websocket auth means the rules
(signature, issuer/audience, tokenVersion revocation) can never diverge.
Client-sent identity is never trusted — checklist rule. Rejecting at
handshake also costs attackers a connection attempt, not a per-event check.

**Interview one-liner:** "REST and websockets authenticate through the
same function, so a revoked token dies everywhere at once."

## D3.3 — Room join re-authorized against the database

**Alternatives:** trust that knowing the 128-bit room code is proof enough.
**Decision:** `join-room` loads the Interview document and verifies the
socket's user is the interviewer or the candidate; non-participants get
the same "Interview not found" as nonexistent rooms; cancelled interviews
refuse entry (mirror of REST's 404/410 from M2).
**Why:** the room code is *unguessable*, but URLs get shared, screenshotted
and pasted into the wrong chat. Possession of a link must not equal access
— membership does. Defence in depth: crypto-random code AND identity check.

## D3.4 — Server relays signaling but never media

**Decision:** the `signal` handler forwards SDP offers/answers/ICE
candidates opaquely to the room peer; audio/video flows peer-to-peer via
WebRTC (DTLS-SRTP encrypted), never through our server.
**Why:** privacy (the server *cannot* see or record calls — a guarantee,
not a promise), bandwidth (a free-tier server can't relay video anyway),
and simplicity (the server needs zero media logic). The server's only
job is introductions; the browsers do the talking.

## D3.5 — Per-socket event rate limiting + payload bounds

**Decision:** a token-bucket (`30 events/sec`) on every socket via
`socket.use`; `maxHttpBufferSize: 100kb` caps any packet; chat capped at
1 000 chars (truncated), code pad at 50 000 (dropped), languages
whitelisted by enum.
**Why:** the express-rate-limit middleware from M1 only covers HTTP — an
authenticated socket would otherwise be an unthrottled channel to flood
the peer. 30/sec is generous for typing yet orders of magnitude below
attack rates. Two cap behaviours on purpose: chat *truncates* (losing tail
of a long message is fine), code *drops* (a truncated program is corrupt).

## D3.6 — Ephemeral in-memory room state, deliberately not persisted

**Alternatives:** persist chat and code to MongoDB; Redis for room state.
**Decision:** a `Map` of roomCode → {code, language, participants}; the
joiner receives current pad state (refresh survives); the last disconnect
deletes the room's state entirely.
**Why:** chat and pad contents are *conversation*, not *record* — the
persistent record of an interview is the feedback (M2). Not storing
transient conversation is a privacy feature and keeps v1 dependency-free.
Trade-off accepted: state dies with a server restart, and horizontal
scaling would need the Socket.IO Redis adapter — both documented, neither
needed at v1 scale (see checklist "prefer secure defaults; minimal deps").

## D3.7 — 1:1 room capacity with reconnection allowance

**Decision:** a room admits at most 2 *distinct users*; the same user may
reconnect (refresh, second tab) without being counted twice; capacity
check happens after authorization, not before.
**Why:** the product is 1:1 interviews (PRD non-goal: group calls). The
distinct-user rule (a `Set` of userIds, not a socket count) means a
flaky network can't lock a participant out of their own interview.
Disconnect cleanup only removes a user when their *last* socket is gone.

## D3.8 — Guard closure for in-room events

**Decision:** every in-room handler is wrapped in `inRoom()` — events from
sockets that never joined a room are silently dropped.
**Why:** an authenticated user could otherwise emit `chat-message` or
`signal` without ever passing the room authorization gate (D3.3),
spraying events into... nothing, but the guard makes the invariant
explicit: *no relay without an authorized room*. Proven by test
("chat from room-less socket dropped").

## D3.9 — Real-socket integration tests over unit tests

**Decision:** `tests/m3-signaling.test.mjs` — 22 assertions using real
socket.io-client connections against the live server: anonymous handshake
rejection, outsider join rejection, relay scoping, HTML-as-inert-text
chat, truncation bounds, language whitelist, refresh-resync, post-cancel
lockout.
**Why:** same philosophy as M2 (D2.8) — the bugs that matter here live in
the handshake/authorization seams that mocks would paper over. The
`socket.io-client` dependency is dev-only.
