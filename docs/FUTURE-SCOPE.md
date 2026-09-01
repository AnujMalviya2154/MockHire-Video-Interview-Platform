# Future Scope — WebRTC Connectivity & Platform Enhancements

**Project:** MockHire — Real-Time Video Interview Platform  
**Document Version:** 1.1 (Post-M11 Update)  
**Status:** Research & Planning Phase

---

## Overview

This document outlines future enhancements to improve WebRTC connectivity, user experience, and platform scalability. Following the M11 Cloudflare TURN integration, the platform now achieves highly reliable cross-network connectivity. The roadmap below targets further platform hardening, UX improvements, and advanced scalability.

---

## Current State & Known Limitations

### ✅ What Works Today (M11 Baseline)
- 1:1 WebRTC video/audio with screen share
- Perfect negotiation (handles offer collisions)
- Highly reliable cross-network connections via Cloudflare TURN fallback
- Mobile-resilient signaling (M9 fixes for ghost disconnects)
- Security-first architecture (128-bit room codes, DB authorization)
- Strict application-level TURN safety model (800 GiB cutoff)

### ⚠️ Known Limitations
| Issue | Impact | Current Workaround |
|-------|--------|-------------------|
| Client-reported telemetry | Abuse risk: clients could suppress TURN usage reporting | Conservative time-based overestimation |
| Fixed video quality | No adaptation on slow networks | None |
| No pre-call diagnostics | Users discover issues after joining | None |
| 1:1 capacity only | Cannot support panel interviews | None |

---

## Priority 1: M12 Infrastructure Hardening

### 1.1 Provider-Authoritative TURN Reconciliation
**Problem:** The M11 safety model relies on client `getStats()` telemetry to increment the billing estimate. A modified client could suppress this reporting, evading the local 800 GiB cutoff.
**Solution:** Implement an async worker to query the Cloudflare GraphQL Analytics API periodically, replacing the client-reported estimate with the provider-authoritative egress total.
**Effort:** 10-15 hours

### 1.2 Advanced Rate Limiting & Abuse Detection
**Problem:** A script could schedule thousands of fake interviews to generate TURN credentials.
**Solution:** Introduce IP-level rate limiting on the authenticated ICE endpoint, coupled with CAPTCHA on registration.

---

## Priority 2: User Experience Improvements (Medium Impact)

### 2.1 Adaptive Bitrate / Quality Adjustment
**Problem:** Fixed quality causes pixelation on slow networks or connection drops.
**Solution:** Monitor `RTCPeerConnection.getStats()` and adjust video constraints dynamically.
**Implementation:** Gracefully degrade to 480p/360p when bandwidth drops below 1 Mbps.
**Effort:** 4-6 hours

### 2.2 Audio-Only Fallback
**Problem:** When video fails but audio could work, call drops entirely.
**Solution:** Detect repeated video failures → disable video, keep audio.
**Effort:** 3-4 hours

### 2.3 Pre-Call Network Diagnostics
**Problem:** Users join the room only to discover their network won't support the call.
**Solution:** Test connectivity during lobby phase (STUN/TURN reachability, mic/cam). Warn before entering.
**Effort:** 6-8 hours

### 2.4 Enhanced Reconnection UI
**Problem:** "Reconnecting..." notification is basic.
**Solution:** Implement Google Meet-style seamless recovery UI with countdown timers and exact state representations.
**Effort:** 2-3 hours

---

## Priority 3: Scalability & Production Upgrades

### 3.1 Horizontal Scaling for Signaling (Socket.IO)
**Current Limitation:** Single Node.js process, in-memory room state.
**Solution:** Use Redis adapter for Socket.IO to share state across instances.
**When Needed:** >100 concurrent calls.

### 3.2 Call Analytics & Monitoring
**Tracking Metrics:**
- Connection success rate (STUN vs. TURN vs. failed)
- Time to establish connection (ICE gathering time)
- Regional success rates
**Effort:** 12-16 hours

---

## Priority 4: Advanced Features (v2 Backlog)

### 4.1 Multi-Panel Interviews (3+ Participants)
**Current:** Strict 1:1 room capacity.
**Changes Needed:** Mesh topology (N² connections) or SFU (Selective Forwarding Unit), UI redesign for grid layout, bandwidth multiplier.
**Recommended:** Migrate to a third-party SFU if this becomes a core requirement.

### 4.2 Email Notifications
**Triggers:** Interview scheduled, 15 minutes before interview, feedback submitted.
**Privacy:** Never include room code in email (security risk).

### 4.3 Password Reset Flow
**Current:** No password recovery.
**Implementation:** Generate time-limited token, verify via email link, bump `tokenVersion`.

---

## Document History

| Version | Changes |
|---------|---------|
| 1.0 | Initial draft — comprehensive WebRTC connectivity roadmap |
| 1.1 | Post-M11 update — Removed STUN-only assumptions, added M12 hardening |
