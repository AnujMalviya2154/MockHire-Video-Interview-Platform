# M5 — Interview Room (WebRTC video, chat, screen share, code pad)

**Commit:** `feat(client): webrtc video room with chat, screen share, code editor`

M5 turns the M4b room lobby into the full in-call experience: 1:1 WebRTC
video, screen share, live chat and a shared code pad — all riding the M3
socket relay with **zero server changes**. `git status` confirms nothing
under `server/` moved; the M2 (27/27) and M3 (22/22) suites still pass
against the unchanged backend.

New files: `lib/rtc.js`, `lib/socket.js`, `components/room/ControlBar.jsx`,
`components/room/SidePanel.jsx`, `components/room/VideoTile.jsx`.
Rewritten: `pages/InterviewRoom.jsx` (lobby → live → ended phases).

---

## D5.1 — The code pad is a textarea, not an editor

**Decision:** The shared code pad is a monospace `<textarea>` with a
line-number rail, a Tab-inserts-two-spaces handler, a language label
selector and a live character budget. No Monaco, no CodeMirror, no
syntax highlighting, no execution.

**Alternatives considered:** Monaco (VS Code's editor, ~2 MB), CodeMirror 6
(smaller but still a dependency tree plus language packages).

**Why:** The PRD (FR-5) scopes the pad to *sync only* — no execution, no
compilation. Both real editors exist to parse and decorate code; we'd ship
megabytes to decorate text the server deliberately treats as inert. A
textarea has no parsing surface, no worker processes, no versions to
audit — and the "server treats code as opaque text" security story stays
literally true in the UI too. The character counter mirrors the server's
50 kB cap so the user sees the same limit the server enforces.

**Interview one-liner:** "The pad is a textarea on purpose: the
requirement was synchronized text, and every editor library would have
added attack surface to decorate content the server refuses to interpret."

## D5.2 — Perfect negotiation; politeness derived from role

**Decision:** WebRTC signaling implements MDN's *perfect negotiation*
pattern. The polite/impolite roles are derived from data both sides
already share: **the candidate is polite, the interviewer impolite.**

**Alternatives considered:** (a) naive offer/answer where the first
joiner always offers — breaks on glare (both sides offering at once) and
on renegotiation; (b) electing politeness by join order — needs an extra
signaling exchange to agree who was first.

**Why:** Glare is not an edge case here: both parties sit in a lobby and
click "Enter room" around the scheduled minute, and screen share triggers
mid-call renegotiation. Perfect negotiation resolves every collision
deterministically — the impolite side ignores an incoming offer while its
own is outstanding; the polite side rolls back and answers. Deriving
politeness from role means zero extra protocol: both clients already know
both roles from the interview record.

**Interview one-liner:** "Offer glare resolves with zero extra signaling
because politeness is a function of data both peers already have — the
role on the interview record."

## D5.3 — Public STUN only, no TURN (accepted limitation)

**Decision:** ICE uses one public Google STUN server. No TURN relay in v1.

**Why:** STUN just tells a peer its public address — free, stateless,
no secrets (the PRD already documents this risk in §7). TURN relays the
actual media, which means running and paying for a server, managing its
credentials, and explaining why call traffic suddenly transits our
infrastructure. For the demo target (two browsers on one machine or one
LAN) direct or STUN-assisted paths always succeed. Pairs of symmetric
NATs would need TURN; that's listed as future work, not silently broken:
the room shows an honest "Reconnecting" state if the path dies.

**Interview one-liner:** "STUN discovers the path, TURN pays for a
detour; v1 needs discovery, not detours — documented, not discovered in
production."

## D5.4 — Screen share swaps the sender's track (replaceTrack)

**Decision:** Screen share replaces what the existing video sender
transmits via `RTCRtpSender.replaceTrack()` — camera track out, screen
track in, and back on stop. The transceiver (not the sender) is the
lookup handle, so a camera-less participant can still share: their
recvonly video line is flipped to sendrecv for the duration.

**Alternatives considered:** adding a second video track (peer must
handle n tracks, layout ambiguity, more renegotiation), or a second
RTCPeerConnection just for the screen (double the ICE, double the
failure modes).

**Why:** One video lane whose content changes is exactly the product
semantics: you see either their face or their screen, never a grid.
`replaceTrack` on the same m-line usually avoids renegotiation entirely,
and when a direction flip does force one, perfect negotiation (D5.2)
absorbs it. The browser's own "Stop sharing" bar is also handled — the
track's `onended` restores the camera so UI state can't drift from
transmission state.

**Interview one-liner:** "Screen share is not a second call — it's the
same video sender transmitting a different track, which is one
`replaceTrack` instead of a renegotiation dance."

## D5.5 — Presence and mute state ride the opaque signal relay

**Decision:** Mic/cam/share state travels as `{ meta: {...} }` payloads
through the M3 `signal` relay — the same channel as SDP/ICE. The server
still never inspects any of it. Any inbound signal also marks the peer
present (covers joining second, where no `peer-joined` event fires for us).

**Alternatives considered:** new server events (`peer-state`,
`presence`) — requires M3 changes, new validation, new tests; or muting
by stopping tracks — makes unmute a renegotiation and loses the
"muted" badge on the far side.

**Why:** The relay already guarantees the two properties that matter:
only the authorized peer receives it, and it's bounded by the packet cap
and rate limit. Mute keeps tracks alive but disabled
(`track.enabled = false`) — instant, no renegotiation — and the meta
message lets the far side render an honest muted badge instead of a
frozen frame. Server diff for all of M5: zero lines.

**Interview one-liner:** "The server relays opaque bytes between two
authorized people; whether those bytes are an SDP offer or 'my mic is
off' is none of its business."

## D5.6 — One media lifecycle owned by the page

**Decision:** `getUserMedia` runs once when the room page loads; the
same `MediaStream` feeds the lobby preview, the peer connection, and the
corner self-view. Every exit path — Leave button, route unmount, fatal
connection loss — funnels through one teardown that stops every track,
destroys the peer connection and drops the socket.

**Why:** The camera light is a trust indicator. If tracks were acquired
per-phase, a missed cleanup in any phase leaks a live camera after the
user thinks they left. With one owner (refs on the page component, since
React state is asynchronous and cleanup must be synchronous), the
teardown is provably complete: stop `streamRef`, destroy `peerRef`,
disconnect socket — nothing else ever holds media. Denied permissions
degrade instead of blocking: you can still join, watch, and chat
(recvonly transceivers), matching the lobby's honest warning copy.

**Interview one-liner:** "Whoever owns the stream owns the leak — so
exactly one component owns it, and every exit path runs the same three
teardown lines."

## D5.7 — Reconnect re-joins the room; terminal loss fails loudly

**Decision:** On socket reconnect, the client silently re-runs the
`join-room` authorization and re-announces its state; the ack restores
the current pad contents (M3's refresh-resync doing double duty). If
reconnection fails for good, a `fatal()` path tears everything down and
shows the full-page error screen — in any phase.

**Why:** Server room membership is per-connection; a new connection is a
stranger until it re-authorizes, so without the re-join every relay after
a network blip would silently vanish. And a call that can't come back
should say so, not leave a frozen frame pretending: fail loudly, clean up
media (the camera light goes off), offer the dashboard.

**Interview one-liner:** "A reconnected socket is a new identity to the
server — the client re-proves room membership on every reconnect, and if
it can't, the room says so instead of freezing."

## D5.8 — Room UI: keyboard-first controls, two-press leave, honest states

**Decision:** The control bar is the M4b vocabulary on air: real buttons
with `aria-pressed`, tooltips carrying single-key shortcuts (M/V/C,
suppressed while typing or with modifiers), an unread chat badge, and a
two-press leave (arm → confirm, 4 s auto-disarm) matching the dashboard's
InlineCancel. Every transient state has UI: waiting for peer, connecting
video, reconnecting, peer muted, "you're presenting". Motion follows
D4b.8 — one entrance timeline going on air (brand register), CSS state
transitions after that, everything behind `prefers-reduced-motion`.

**Why:** In-call controls are used mid-conversation, half-attention;
shortcuts and big hit targets are function, not garnish. Leave is the
only irreversible action in the room, so it costs two presses — same
rule, same reason as cancel on the dashboard. And each network state
rendering honestly ("Reconnecting", not a frozen tile) is the visible
half of D5.7.

---

## Security review (per SECURITY-CHECKLIST.md)

- **Server surface unchanged:** zero lines changed under `server/`;
  M2 suite 27/27, M3 suite 22/22 against the running server.
- **Authorization unchanged and re-proved:** page load hits the M2
  participant-gated REST endpoint; socket join re-checks the DB record
  (M3); reconnect re-authorizes (D5.7). Outsiders still get
  indistinguishable 404s.
- **All user content rendered as React text nodes** — chat, names, code.
  No `dangerouslySetInnerHTML` anywhere in the client.
- **Client mirrors, server enforces:** chat 1000 chars, code 50 kB,
  language whitelist all capped client-side for UX and enforced
  server-side (M3 tests prove truncation/drop).
- **No secrets introduced:** STUN URLs are public infrastructure;
  nothing sensitive in the bundle; `npm audit` 0 vulnerabilities in both
  packages.
- **Media privacy:** media is peer-to-peer DTLS-SRTP; nothing recorded,
  nothing persisted (chat/pad state die with the room, M3). Every exit
  path stops all tracks (D5.6) — verified the camera indicator goes off.
- **Rate limits respected:** code-pad emits are debounced (150 ms) under
  the server's 30 events/s socket budget.
- **Verified live:** production build clean; full browser pass — lobby
  (incl. denied-permissions state), join, chat both directions, pad sync
  + language change, presence/mute badges via meta, peer-left back to
  waiting, two-press leave, ended screen. Throwaway verification users
  and their interview deleted from Atlas afterwards.
- **Remaining risks (documented):** no TURN (D5.3 — symmetric-NAT pairs
  won't connect); public STUN dependency; in-memory room state is
  single-process (fine at v1 scale, noted since M3).
