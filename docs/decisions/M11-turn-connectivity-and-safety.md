# M11 Decision Record: TURN Connectivity and Safety

## 1. Context & Problem
MockHire's native WebRTC architecture originally relied entirely on a single public Google STUN server for ICE candidate discovery (M5). While this perfectly handles host candidates (same-network) and server-reflexive candidates (typical residential NATs), it completely fails to establish media when either peer is located behind a restrictive symmetric NAT or corporate firewall. 

To resolve this without replacing our core WebRTC architecture, we need to introduce a Traversal Using Relays around NAT (TURN) provider. Cloudflare Realtime currently provides a generous 1,000 GB/month free Realtime data-transfer allowance across its products.

However, integrating an external relay provider introduces severe architectural risks:
1. **Billing & Abuse:** An unbounded relay service invites uncontrolled financial risk. If left unchecked, usage could exceed the allowance, resulting in paid overages.
2. **Architectural Drift:** MockHire's "Perfect Negotiation" state machine is complex, robust, and heavily tested. Replacing or altering this state machine to force an application-level retry loop (e.g. try STUN, wait, try TURN) would introduce catastrophic instability.

## 2. Architectural Constraints
- **Strict Financial Bounding:** The application must enforce a local safety cutoff well below the provider's 1,000 GB threshold.
- **Perfect Negotiation Invariant:** The existing `polite`/`impolite` negotiation logic, deferred peer creation (M9), and rollback behaviors must remain absolutely untouched.
- **Secret Protection:** Provider API tokens must never be exposed to the client, committed to Git, or persisted in logs.
- **Ephemeral State:** TURN access must align with the existing 8-hour room expiry lifecycle (M10).

## 3. Decision
We will add Cloudflare Realtime TURN as an ICE relay fallback, seamlessly extending our existing `RTCPeerConnection` architecture via dynamic ICE configuration injection, bounded by a strict 800 GiB local safety cutoff.

### The WebRTC Connectivity Model
TURN is infrastructure added to the existing ICE layer, NOT a replacement for WebRTC, a video SDK, or a new signaling mechanism. MockHire injects both STUN and TURN into the initial ICE configuration. The browser's ICE agent performs candidate gathering across host, STUN/srflx, and TURN/relay candidates in parallel:
- If a direct host/srflx candidate pair succeeds, media remains direct P2P.
- If direct candidates fail but a relay candidate succeeds, media flows through TURN.
- If all viable candidate pairs fail, ICE enters a failed state and our existing recovery behavior applies.

There is no application-level retry loop. We trust the browser's ICE agent to select the optimal path.

### Authenticated ICE API & Ephemeral Credentials
A new authenticated endpoint (`GET /api/webrtc/ice-servers`) issues ephemeral credentials bounded by an 8-hour TTL (or the room's remaining lifetime). Permanent provider secrets remain strictly server-side.

### The 800 GiB Safety Cutoff & Graceful Drain
We will maintain a highly conservative application-level safety metric (`estimatedTurnSafetyBytes`), accumulated by multiplying active relay time by a conservative bandwidth ceiling. 
When `estimatedTurnSafetyBytes` crosses 800 GiB:
1. The server stops issuing NEW TURN credentials (returning STUN-only).
2. Existing active TURN-backed rooms are marked as draining, users are notified, and media is terminated after a 60-second grace period.
3. Socket.IO, text chat, and room infrastructure remain intact. Reconnection attempts fall back to STUN-only.
4. Direct P2P calls are completely unaffected.

*Note: Telemetry relies on client reporting. While an accepted limitation for a portfolio project, this means `estimatedTurnSafetyBytes` is an application approximation, not a cryptographic or provider-authoritative billing metric.*

## 4. Implementation Plan
1. **STAGE 1:** Authenticated ICE endpoint + Cloudflare credential generation + validation.
2. **STAGE 2:** Persistent MongoDB monthly accounting (`TurnUsage`) + time-based estimation service.
3. **STAGE 3:** Dynamic client-side ICE injection into `createPeer()`, preserving Perfect Negotiation.
4. **STAGE 4:** Client connection-mode telemetry (getStats) + server-side relay detection logic.
5. **STAGE 5:** 800 GiB safety cutoff, active monitoring loop, 60-second graceful drain.
6. **STAGE 6:** Diagnostics, physical cross-network verification.
7. **STAGE 7:** Documentation, security audits, and production finalization.

## 5. Provider Contract Mismatch (Bug Discovery & Fix)
During Stage 1 development, the automated tests were written against a mock fixture that assumed Cloudflare's `/credentials/generate` returned an array for `iceServers`. The tests passed.

When the real provider was integrated, the request succeeded (HTTP 201), but MockHire crashed. **Cloudflare actually returns an object, not an array.**

**Resolution:** 
- The `extractCredentials()` utility was updated to normalize both the actual object shape and the array shape.
- The test suite was expanded to cover the real provider response shape, catching the regression.
- A real-provider integration test (`verify_endpoint.mjs`) was used locally to confirm the contract before merging.
- **Lesson:** Provider mocks are not a substitute for real-provider contract verification.

## 6. Verification & Physical Testing

M11 verification passed across 154 automated integration tests. Furthermore, physical cross-network testing confirmed the real-world behavior:

| Test Scenario | Result | Evidence |
|---------------|--------|----------|
| Wi-Fi ↔ Wi-Fi | PASS | `chrome://webrtc-internals` confirmed host candidates (192.168.x.x) selected. Direct P2P preserved. |
| Wi-Fi ↔ Jio Cellular | PASS | `relay` candidates selected. Media routed through Cloudflare TURN. |
| Wi-Fi ↔ Vi Cellular | PASS | `relay` candidates selected. Media routed through Cloudflare TURN. |

**Observations:**
- TURN fallback succeeded seamlessly when symmetric NATs blocked P2P.
- The presence of TURN credentials did not override WebRTC's preference for direct host candidates on the same network.
- Audio, Video, Screen Sharing, and Code Synchronization operated perfectly across the relay.

## 7. Security Decisions
- Permanent API credentials are not logged, returned, or included in test artifacts.
- The authenticated ICE endpoint leverages the exact same httpOnly JWT authorization as the rest of the API.
- Cloudflare's `customIdentifier` is safely derived (e.g., hashed or sanitized) to prevent PII leakage to the provider's analytics dashboard.
- The 60-second drain ensures that hitting the safety limit does not violently crash the room, preserving the user's ability to chat and export code.

## 8. Accepted Residual Risks
- **Client Manipulation:** The relay telemetry depends on the client's `getStats()` report. A malicious client could suppress this report to evade the local safety cutoff. This is an accepted risk for this tier of project; provider-side authoritative limits are the only true defense against dedicated abuse.
- **Conservative Estimation Overbilling:** The time-based bandwidth estimation intentionally overestimates lightweight calls (audio-only) to maintain a safety margin, meaning the 800 GiB limit will trip earlier than actual network egress requires.

## 9. Alternatives Considered
1. **Multiple public STUN servers:** Rejected. STUN redundancy does not bypass symmetric NATs.
2. **Self-hosted coturn on Render:** Rejected. Render's Web Service environment is heavily constrained and not designed for high-throughput UDP media relaying.
3. **Third-party SFU / Video SDK (Daily.co, Twilio):** Rejected. Adopting an SDK would replace the core WebRTC architecture, defeating the primary engineering objective of the project.

## 10. Consequences
- **Positive:** MockHire gains substantially more reliable cross-network connectivity, vastly improving the core product experience. The native WebRTC architecture is perfectly preserved. The financial risk of a free relay provider is heavily mitigated by the safety cutoff.
- **Negative:** The backend is now stateful regarding active room timers and telemetry monitoring, slightly increasing operational complexity.

## 11. Final Status
M11 is fully implemented, verified, merged, and deployed to production.
