# M11: TURN Connectivity and Safety

## Context & Problem
MockHire's native WebRTC architecture currently relies entirely on a single public Google STUN server for ICE candidate discovery. While this perfectly handles host candidates (same-network) and server-reflexive candidates (typical residential NATs), it completely fails to establish media when either peer is located behind a restrictive symmetric NAT or corporate firewall. 

To resolve this without replacing our core WebRTC architecture, we need to introduce a Traversal Using Relays around NAT (TURN) provider. Cloudflare Realtime currently provides a 1,000 GB/month free Realtime data-transfer allowance, shared across Realtime products; MockHire uses only TURN. However, providing external relay capabilities creates the risk of unbounded billing if left unchecked. We require an architectural model that leverages Cloudflare TURN while establishing strict, conservative, application-level safety limits to prevent abuse or accidental overage, all while completely preserving our existing Perfect Negotiation implementation.

## Decision
We will add Cloudflare Realtime TURN as an ICE relay fallback, seamlessly extending our existing `RTCPeerConnection` architecture. 

### 1. The WebRTC Connectivity Model
TURN is infrastructure added to the existing ICE layer, NOT a replacement for WebRTC, a video SDK, or a new signaling mechanism. 
MockHire does NOT implement an application-level retry stage (e.g., trying STUN, failing, then trying TURN). Instead, we inject both STUN and TURN into the initial ICE configuration. 
The browser's ICE agent performs candidate gathering across host, STUN/srflx, and TURN/relay candidates in parallel:
- If a direct host/srflx candidate pair succeeds, media remains direct P2P.
- If direct candidates fail but a relay candidate succeeds, media flows through TURN.
- If all viable candidate pairs fail, ICE enters a failed state and our existing recovery behavior applies.
There will be exactly one Google STUN server and one Cloudflare TURN provider configured. 

### 2. Perfect Negotiation (Protected Invariant)
The existing Perfect Negotiation implementation is a proven, immutable architectural invariant. We will not rewrite or modify any negotiation logic. The polite/impolite logic, deferred peer creation (M9), rollback behavior, `negotiationneeded` flow, `createOffer`/`createAnswer` behavior, and Socket.IO signaling flows remain entirely unchanged. TURN integration occurs strictly at the ICE configuration layer via dynamic `iceServers` injection.

### 3. Authenticated ICE API & Configuration
We will introduce a new authenticated endpoint: `GET /api/webrtc/ice-servers`.
The server will request short-lived credentials from Cloudflare's TURN API. The response will be strictly normalized to retain the required TURN transports while excluding unsupported RFC 6062 TCP-relaying behavior. 
The final ICE configuration will contain:
1. The existing Google STUN server.
2. Cloudflare TURN over UDP (`turn:turn.cloudflare.com:3478?transport=udp`).
3. Cloudflare TURN over TLS on port 443 (`turns:turn.cloudflare.com:443?transport=tcp`).

### 4. Cloudflare Credential Architecture
Credentials will be ephemeral and generated on-demand. Permanent Cloudflare secrets (`TURN_KEY_API_TOKEN`) remain strictly server-side.
- **TTL:** The credential TTL will be capped at `min(8 hours, remaining room lifetime)`, aligning with the M10 room expiry lifecycle. 
- **Analytics Correlation:** We will utilize Cloudflare's `customIdentifier` support when generating credentials, embedding a safe string (e.g., `mockhire:<interviewId>:<userId>`) to allow correlation in Cloudflare's analytics without leaking PII.

### 5. Estimated TURN Safety Usage (`estimatedTurnSafetyBytes`)
To prevent unbounded billing, we will maintain an internal, intentionally conservative application-level safety budget metric named `estimatedTurnSafetyBytes`. 
This is NOT Cloudflare's authoritative usage metric. We use byte-based accounting, assuming a conservative maximum bandwidth ceiling. The server accumulates usage by calculating elapsed time multiplied by this ceiling while the room is actively relay-backed. We overestimate usage to safely protect against provider overage. 

### 6. TURN-Backed Room State & Telemetry
A room is considered TURN-backed when either participant reports via client telemetry that their successful selected ICE candidate pair uses a relay candidate. 
This telemetry is authenticated and operationally useful, but because it originates from the client, it is not a cryptographically authoritative billing truth. This is an accepted portfolio-project limitation. When peers disagree (e.g., one reports direct, the other relay), the server conservatively reconciles the room as TURN-backed.

### 7. The 800 GiB Safety Cutoff & Graceful Drain
We will implement a hard internal cutoff at **800 GiB** for the current month. This threshold provides a substantial safety margin below the provider's 1,000 GB free allowance and is designed to minimize the risk of paid overage under normal and accidental usage.
When `estimatedTurnSafetyBytes` crosses 800 GiB:
- The server stops issuing NEW TURN credentials (new requests receive STUN-only).
- Existing direct P2P rooms remain completely untouched.
- Active TURN-backed rooms are marked as draining, and participants receive a UI notification ("Relayed connection capacity reached. This connection will end shortly.").
- After an approximately 60-second grace period, the TURN-backed WebRTC media session is terminated.
- Crucially, Socket.IO, text chat, and room infrastructure remain intact. Reconnection attempts will fallback to STUN-only.

### 8. Credential Expiry & Cloudflare Analytics
The primary enforcement is our 800 GiB cutoff and active 60-second drain. 
- **Expiry:** The hard 8-hour credential TTL acts as an additional provider-level safeguard. 
- **Analytics:** Cloudflare's provider-side `egressBytes` analytics will be used purely for monitoring, manual verification, and validating our conservative safety estimate, not as an instantaneous account-wide kill switch.

### 9. MongoDB Persistence
Monthly usage will be persisted via a minimal MongoDB model (`TurnUsage`) to survive Render process restarts. Active room tracking remains ephemeral in memory.

### 10. Fallbacks
- **Cloudflare unavailable / timeout / malformed:** Fallback instantly to STUN-only.
- **800 GiB reached:** Fallback to STUN-only for new sessions.
- **Direct P2P succeeds:** Media flows P2P.
- **Direct P2P fails + TURN succeeds:** Media flows through TURN.
- **Direct P2P fails + TURN fails:** ICE enters a failed state, handled by existing recovery mechanisms.

## Implementation Order
This is the exact implementation sequence decided for M11:
1. **STAGE 1 — Cloudflare credential endpoint + configuration validation:** Server-side credential integration, authenticated ICE endpoint, 8-hour/room TTL, validation/normalization, timeout handling.
2. **STAGE 2 — TurnUsage persistence + safety budget:** TurnUsage model, monthly boundary, persistent Mongo accounting, conservative time × bandwidth estimation.
3. **STAGE 3 — Dynamic ICE configuration injection:** Client API call, dynamic retrieval, injection into `createPeer()`, preserving negotiation.
5. **STAGE 5 — 800 GiB cutoff + 60-second TURN drain:** Stop credential issuance, mark active rooms draining, notify users, 60s grace, terminate TURN-backed media, protect P2P rooms, STUN-only reconnect.
6. **STAGE 6 — Production diagnostics and verification:** Same/cross-network tests, mobile hotspot tests, restrictive-network tests, verify reconnect, inspect analytics.
7. **STAGE 7 — Documentation and final verification:** Architecture/security updates, final deployment verification.

## Implementation Status

M11 implementation is complete through Stage 5 of 7. Local provider integration has been verified, while physical cross-network TURN verification remains pending.

✅ Stage 1 — COMPLETE
Implemented authenticated ICE endpoint `/api/webrtc/ice-servers` with Cloudflare credential generation, 8-hour/room TTL validation, STUN-only fallback, and security normalization.

✅ Stage 2 — COMPLETE
Implemented `TurnUsage` MongoDB model for monthly accounting, atomic increment service, restart persistence, and safe numeric boundaries.

✅ Stage 3 — COMPLETE
Implemented dynamic client-side ICE injection into `RTCPeerConnection` without modifying the core Perfect Negotiation logic.

✅ Stage 4 — COMPLETE
Implemented `getStats` connection-mode telemetry, generation/sequence race-condition protection, and conservative room reconciliation policy in Socket.IO.

✅ Stage 5 — COMPLETE
Implemented the 800 GiB safety cutoff, active monitoring loop, graceful 60-second TURN drain, STUN-only reconnect logic, and post-cutoff migration handling.

⏳ Stage 6 — IN PROGRESS / PHYSICAL VERIFICATION PENDING
Physical production/cross-network verification remains outstanding.

⏳ Stage 7 — PENDING
Final documentation/security/deployment verification remains outstanding.

### Stage 1 Provider Integration Correction

1. **What happened:** The first real request to Cloudflare succeeded with HTTP 201, but MockHire rejected the response because the implementation expected `iceServers` to be an array.
2. **Why automated tests missed it:** The Stage 1 test fixture (`MOCK_CF_RESPONSE`) modeled the response incorrectly as an array, so the original suite passed despite the provider-contract mismatch.
3. **What the real provider returned:** `/credentials/generate` returned `iceServers` as a single object containing `urls`, `username`, and `credential`.
4. **The fix:** `extractCredentials()` was updated to support and validate the actual object response shape while retaining explicit support for the array shape if intentionally supported.
5. **Test correction:** The test fixture was split/updated so both actual provider shapes are explicitly tested where applicable.
6. **Verification:** A real-provider integration test was added using the configured local Cloudflare credentials.
7. **Result:** The real Cloudflare request succeeded, MockHire normalized the response correctly, and the cumulative test suite reached 104/104.
8. **Security:** Permanent API credentials were not logged, returned, or included in test artifacts.

Provider mocks are not a substitute for real-provider contract verification. The real Cloudflare integration test exposed the mismatch prior to deployment.

### Cumulative Verification
- Stage 1: 17/17 tests
- Stage 2: 58/58 cumulative tests
- Stage 3: 63/63 cumulative tests
- Stage 4: 71/71 cumulative tests
- Stage 5: 99/99 before the provider-shape correction
- After provider-shape correction: 104/104 cumulative tests

These additional tests were added specifically to cover the real provider response shape and regression behavior.


## Testing Requirements
Acceptance criteria include:
- Authenticated ICE endpoint success and fallback.
- 8-hour credential TTL and room-lifetime cap.
- Persistent monthly accounting and the 800 GiB cutoff enforcement.
- 60-second graceful relay drain while preserving direct P2P rooms.
- No secret leakage and strict Perfect Negotiation / Socket.IO / screen-sharing regression protection.
- Verified same-network and cross-network TURN connectivity.

## Security Decisions
- Permanent Cloudflare secrets remain strictly server-side.
- No provider secret reaches `VITE_*`, Git, or logs.
- The authenticated ICE endpoint preserves existing authorization.
- No weakening of CORS, SameSite, or CSP policies.
- Custom identifiers omit unnecessary sensitive data.

## Alternatives Considered
1. **STUN-only:** Rejected due to insufficient cross-network reliability.
2. **Self-hosted coturn on Render:** Rejected because Render's Web Service networking is not an ideal public TURN transport environment.
3. **Multiple public STUN servers:** Rejected because they do not solve symmetric-NAT requirements and add unnecessary complexity.
4. **Paid TURN:** Rejected as a free managed TURN path is sufficient for this portfolio project.
5. **Third-party video SDK / SFU:** Rejected because it replaces the core architecture and violates the project's native-WebRTC objective.

## Consequences
- **Positive:** MockHire gains substantially more reliable cross-network connectivity across restrictive NAT environments while preserving the native WebRTC architecture and adding a highly conservative, application-level safety model to minimize the risk of provider overage.
- **Negative:** Telemetry-based accounting is subject to client circumvention (an accepted risk), and the time-based calculation inherently overbills lightweight sessions to maintain its safety margin.
