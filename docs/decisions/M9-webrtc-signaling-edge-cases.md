# M9: WebRTC Signaling Edge Cases & Collision Resolution

## Context & Problem
During cross-device production testing, a critical failure in the WebRTC signaling flow was identified. The symptoms manifested as a complete inability to establish media (audio/video/screenshare) between two physically distinct devices, despite the `RTCPeerConnection` showing as created. Local testing (two browser windows on the same machine) succeeded, masking the issue.

Extensive instrumentation (`[RTC-DIAG]`, `[ROOM-DIAG]`) revealed two distinct signaling race conditions that occur in real-world latency environments, particularly impacting mobile browsers:

### 1. The Implicit Rollback Failure (Mobile WebRTC Bug)
**The Race:** When both peers join the room simultaneously, both execute `ensurePeer()`, fire `onnegotiationneeded`, and generate an `offer` concurrently.
**The WebRTC Standard:** "Perfect Negotiation" dictates that the "polite" peer yields by ignoring its own offer, accepting the impolite peer's offer via `setRemoteDescription`, which *implicitly rolls back* the local offer.
**The Failure:** Older Android Chrome and some iOS Safari versions have a known bug where implicit rollback during `have-local-offer` fails, throwing an `InvalidStateError`. This permanently breaks the negotiation chain, resulting in no `answer` ever being sent.

### 2. The Ghost Disconnect (Refresh Race Condition)
**The Race:** When a user refreshes the browser mid-call (e.g., toggling "Desktop Site" on Chrome Mobile), a new WebSocket connects and joins the room *before* the server processes the TCP timeout/disconnect of the old WebSocket.
**The Failure:** 
1. New socket joins `→` Server broadcasts `peer-joined`.
2. Old socket disconnects (milliseconds later) `→` Server broadcasts `peer-left`.
3. Both peers receive `peer-left` and dutifully destroy their active `RTCPeerConnection` objects.
4. The peers are left in a zombie state, waiting for an offer that will never arrive.

## Decision & Implementation

### Fix 1: Offer Deferral (Avoiding Implicit Rollback)
Instead of relying on the buggy implicit rollback mechanism on mobile devices, we **avoid the offer collision entirely**.
- The "polite" peer (Candidate) now **defers** peer creation when it receives an inbound `meta` signal. It only replies with its own `meta` state.
- The peer connection on the polite side is created lazily *only* when the actual `offer` (description/candidate) arrives from the impolite peer. 
- This guarantees a strict single-offer flow where the polite peer is always in a `"stable"` state when receiving the remote offer.

### Fix 2: Breaking the Infinite `meta` Ping-Pong
Implementing Fix 1 introduced a regression: because both sides deferred peer creation, they infinitely echoed the `meta` signal back and forth.
- We introduced `metaRepliedRef` in `InterviewRoom.jsx` to track whether the client has already responded to a `meta` signal while waiting for the actual offer.
- This breaks the ping-pong loop, allowing the single-offer flow to proceed smoothly.

### Fix 3: Backend Presence Tracking for Ghost Disconnects
To resolve the Ghost Disconnect race condition (which previously required a manual hard-refresh from both sides if triggered), a backend presence check was implemented in `server/src/socket/index.js`.
- The server's `disconnect` handler now checks if the user has any *other* active sockets in the room before emitting `peer-left` and removing them from the `participants` set.
- This makes mid-call refreshes and transient network drops completely seamless.

## Consequences
- **Positive:** WebRTC connection establishment is now highly deterministic and resilient across diverse mobile and desktop environments. The strict single-offer flow simplifies debugging.
- **Negative:** The signaling logic in `InterviewRoom.jsx` is slightly more complex, managing `metaRepliedRef` state alongside standard WebRTC negotiation. 
