# Future Scope — WebRTC Connectivity & Platform Enhancements

**Project:** MockHire — Real-Time Video Interview Platform  
**Document Version:** 1.0  
**Date:** 31 July 2026  
**Status:** Research & Planning Phase

---

## Overview

This document outlines future enhancements to improve WebRTC connectivity, user experience, and platform scalability. Current implementation achieves ~40-50% connectivity across different networks (STUN-only). The roadmap below targets 95-99.5% connectivity while maintaining cost-effectiveness.

---

## Current State & Limitations

### ✅ What Works Today
- 1:1 WebRTC video/audio with screen share
- Perfect negotiation (handles offer collisions)
- Works reliably on same network/LAN (~99% success)
- Mobile-resilient signaling (M9 fixes for ghost disconnects)
- Security-first architecture (128-bit room codes, DB authorization)

### ⚠️ Known Limitations (Documented in PRD §7, M5 D5.3)
| Issue | Impact | Current Workaround |
|-------|--------|-------------------|
| Single STUN server only | Fails across different networks (symmetric NAT) | None — documented limitation |
| No TURN relay | ~50-60% failure rate for remote participants | None |
| Single-region deployment | High latency for distant users | None |
| Fixed video quality | No adaptation on slow networks | None |
| No pre-call diagnostics | Users discover issues after joining | None |

---

## Priority 1: Cross-Network Connectivity (High Impact)

### 1.1 Implement TURN Relay Server

**Problem:** Symmetric NATs prevent P2P connections between different ISPs (Jio ↔ Airtel, mobile ↔ WiFi).

**Solution Options:**

| Approach | Success Rate | Cost | Setup Time | Production Ready? |
|----------|--------------|------|------------|-------------------|
| **Free TURN (OpenRelay)** | ~60-70% | Free | 30 min | ❌ Unreliable, rate-limited |
| **Self-hosted coturn (Render free)** | ~90-95% | Free | 2-3 hours | ⚠️ Good for demos, bandwidth limits |
| **Xirsys free tier** | ~95% | Free (500 MB/month) | 1 hour | ✅ Good for testing |
| **Twilio TURN** | ~98-99% | ~$0.005/min | 1 hour | ✅ Production-grade |
| **Daily.co / Agora.io** | ~99-99.5% | $0.005-0.01/min | 2-3 hours | ✅ Enterprise-grade |

#### Recommended: Self-hosted coturn on Render (Free Tier)

**Implementation Plan:**
```
1. Create Dockerfile for coturn
2. Configure turnserver.conf (TCP/443 for firewall bypass)
3. Deploy to Render with existing Uptime Robot integration
4. Update client/src/lib/rtc.js ICE_SERVERS configuration
5. Add environment variables (TURN_URL, TURN_USERNAME, TURN_CREDENTIAL)
6. Test across Jio/Airtel/Vi mobile + WiFi combinations
```

**Render Free Tier Constraints:**
- CPU: 0.1 CPU → ~3-5 concurrent calls max
- RAM: 512 MB → ~5-8 concurrent calls max
- Bandwidth: 100 GB/month → ~40-50 hours of relayed video/month
- Cold start: 10-30 seconds after 15 min idle (mitigated by Uptime Robot)

**Expected Outcome:**
- ✅ 90-95% connectivity across different networks
- ✅ Works for Jio/Airtel/Vi mobile data + home broadband
- ✅ Suitable for portfolio demos and small-scale usage
- ⚠️ Limited to ~50 hours/month relayed traffic

**Migration Path to Paid TURN:**
If free tier is exhausted or production scale is needed:
- Twilio: $0.005/min (~$3 per 600-minute month)
- Xirsys Pro: $49/month for 50 GB
- Render Standard: $25/month for 1000 GB bandwidth

---

### 1.2 Add Multiple STUN Servers (Quick Win)

**Benefit:** Redundancy + improved NAT traversal for ~60-70% of cases.

**Implementation:**
```javascript
const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun2.l.google.com:19302" },
  { urls: "stun:stun3.l.google.com:19302" },
  { urls: "stun:stun4.l.google.com:19302" },
  { urls: "stun:stun.voip.blackberry.com:3478" },
  { urls: "stun:stun.iptel.org" }
];
```

**Effort:** 5 minutes  
**Cost:** Free  
**Impact:** Marginal improvement (helps when one STUN server is down)

---

### 1.3 TURN-TLS on Port 443 (Firewall Bypass)

**Problem:** Corporate/university firewalls block UDP and non-standard ports.

**Solution:** Configure TURN to use TCP on port 443 (looks like HTTPS traffic).

**Implementation:**
```conf
# turnserver.conf additions
tls-listening-port=443
listening-ip=0.0.0.0
relay-ip=<RENDER_PUBLIC_IP>
cert=/path/to/cert.pem
pkey=/path/to/key.pem
```

**Effort:** 1-2 hours (SSL certificate setup)  
**Expected Outcome:** Works behind 85-90% of corporate firewalls

---

## Priority 2: User Experience Improvements (Medium Impact)

### 2.1 Adaptive Bitrate / Quality Adjustment

**Problem:** Fixed quality causes pixelation on slow networks or connection drops.

**Solution:** Monitor `RTCPeerConnection.getStats()` and adjust video constraints dynamically.

**Implementation Strategy:**
```javascript
// Monitor bandwidth every 5 seconds
setInterval(async () => {
  const stats = await pc.getStats();
  const bandwidth = calculateBandwidth(stats);
  
  if (bandwidth < 500_000) {      // <500 kbps
    adjustQuality('360p');
  } else if (bandwidth < 1_000_000) { // <1 Mbps
    adjustQuality('480p');
  } else {
    adjustQuality('720p');
  }
}, 5000);
```

**Effort:** 4-6 hours  
**Benefit:** Graceful degradation instead of frozen video

---

### 2.2 Audio-Only Fallback

**Problem:** When video fails but audio could work, call drops entirely.

**Solution:** Detect repeated video failures → disable video, keep audio.

**Implementation:**
```javascript
pc.onconnectionstatechange = () => {
  if (pc.connectionState === 'failed' && retryCount > 3) {
    // Disable video tracks, restart with audio-only
    localStream.getVideoTracks().forEach(t => t.stop());
    pc.getSenders().find(s => s.track?.kind === 'video')?.replaceTrack(null);
    showNotification("Video disabled due to poor connection. Audio continues.");
  }
};
```

**Effort:** 3-4 hours  
**Benefit:** Keeps interview viable even on 2G/3G networks

---

### 2.3 Pre-Call Network Diagnostics

**Problem:** Users join the room only to discover their network won't support the call.

**Solution:** Test connectivity during lobby phase, warn before entering.

**Test Checklist:**
- ✅ Camera/microphone permissions
- ✅ STUN server reachability
- ✅ TURN server reachability (if configured)
- ✅ Upload bandwidth estimate (via test data channel)
- ✅ Latency to signaling server

**UI Treatment:**
```
🟢 Great connection — Ready to join
🟡 Slow network detected — Call may be degraded
🔴 Poor connection — Audio-only recommended
```

**Effort:** 6-8 hours  
**Benefit:** Manages user expectations, reduces frustration

---

### 2.4 Enhanced Reconnection UI

**Current:** "Reconnecting..." notification (basic)  
**Proposed:** Google Meet-style seamless recovery

**Implementation:**
```javascript
// Show timer + progress indicator
"Reconnecting... (attempt 2 of 5)"

// On success
"Connection restored" (auto-dismiss after 2s)

// On failure
"Unable to reconnect. Please refresh the page."
```

**Effort:** 2-3 hours  
**Benefit:** Professional UX, matches user expectations from Meet/Zoom

---

## Priority 3: Scalability & Infrastructure (Future Production)

### 3.1 Multi-Region TURN Deployment

**Problem:** Single Render instance → high latency for distant users.

**Solution:** Deploy TURN servers in multiple regions, route users to nearest.

**Architecture:**
```
Client detects region → Server returns nearest TURN credentials

Regions:
- Asia (Mumbai, Bangalore) — AWS ap-south-1, Render Singapore
- Europe (Frankfurt) — AWS eu-central-1
- US (Oregon) — Render US-West
```

**Effort:** 8-12 hours (infrastructure + routing logic)  
**Cost:** ~$15-30/month (3 small instances)  
**Benefit:** <100ms latency for global users

---

### 3.2 Horizontal Scaling for Signaling (Socket.IO)

**Current Limitation:** Single Node.js process, in-memory room state.

**Solution:** Use Redis adapter for Socket.IO to share state across instances.

**Implementation:**
```javascript
// server/src/socket/index.js
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';

const pubClient = createClient({ url: process.env.REDIS_URL });
const subClient = pubClient.duplicate();
io.adapter(createAdapter(pubClient, subClient));
```

**When Needed:** >100 concurrent calls  
**Effort:** 4-6 hours  
**Cost:** ~$5-10/month (Redis Cloud free tier or Render Redis)

---

### 3.3 Call Analytics & Monitoring

**Tracking Metrics:**
- Connection success rate (STUN vs. TURN vs. failed)
- Time to establish connection (ICE gathering time)
- Bandwidth usage per call
- Reconnection frequency
- Regional success rates

**Tools:**
- WebRTC-internals logs parsing
- Custom analytics endpoint (`POST /api/analytics/call-quality`)
- Dashboard for aggregate metrics

**Effort:** 12-16 hours  
**Benefit:** Data-driven optimization, identify problematic ISPs/regions

---

## Priority 4: Advanced Features (v2 Backlog)

### 4.1 Call Recording

**Current State:** Documented non-goal (PRD §1.4).

**Implementation Options:**
| Approach | Privacy | Cost | Complexity |
|----------|---------|------|------------|
| Client-side recording (MediaRecorder API) | ✅ User controls | Free | Medium |
| Server-side recording (capture TURN traffic) | ⚠️ Server sees media | High bandwidth | Hard |
| Third-party (Daily.co recording API) | ⚠️ Vendor storage | ~$0.004/min | Easy |

**Legal Considerations:**
- Explicit consent required before recording
- GDPR/data retention policies
- Secure storage (encrypted at rest)

---

### 4.2 Multi-Panel Interviews (3+ Participants)

**Current:** Strict 1:1 room capacity (M3 D3.7).

**Changes Needed:**
- Mesh topology (N² connections) or SFU (Selective Forwarding Unit)
- UI redesign for grid layout
- Bandwidth multiplier (3 participants = 2× bandwidth per user)

**Effort:** 20-30 hours  
**Recommended:** Use third-party SFU (Daily.co, Agora) instead of building

---

### 4.3 Code Execution Sandbox

**Current:** Code pad is sync-only (M5 D5.1).

**Implementation:**
- Server-side sandbox (Judge0 API, Piston API)
- Rate limiting (prevent abuse)
- Language-specific Docker containers

**Security Risks:** High (arbitrary code execution)  
**Effort:** 30-40 hours  
**Alternative:** Embed online IDE (Replit, CodeSandbox iframe)

---

### 4.4 Email Notifications

**Triggers:**
- Interview scheduled → send calendar invite to candidate
- 15 minutes before interview → reminder
- Feedback submitted → notify candidate (result only, not comments)

**Services:**
- SendGrid (free tier: 100 emails/day)
- AWS SES (pay-per-use: $0.10/1000 emails)

**Effort:** 6-8 hours  
**Privacy:** Never include room code in email (security risk)

---

### 4.5 Password Reset Flow

**Current:** No password recovery (PRD §1.4).

**Implementation:**
```
1. User requests reset (email)
2. Server generates time-limited token (crypto.randomBytes)
3. Email link: /reset-password?token=...
4. Token validates → allow new password (bcrypt-12)
5. Bump tokenVersion (invalidate old sessions)
```

**Effort:** 4-6 hours  
**Security:** Token expires in 1 hour, single-use only

---

## Priority 5: Alternatives to Self-Hosted TURN

### Option A: Fully Managed WebRTC Services

| Service | Features | Pricing | When to Use |
|---------|----------|---------|-------------|
| **Daily.co** | Video API, recording, transcription | $0.005/min, 10k free mins/month | Fastest time-to-market |
| **Agora.io** | Global network, 99.95% SLA | $0.99/1000 mins | Enterprise production |
| **100ms** | SDK + dashboard, analytics | $0.0019/min | Balance of cost/features |
| **Twilio Video** | Mature, extensive docs | $0.0015/min | Maximum reliability |

**Pros:**
- ✅ 99-99.5% connectivity guaranteed
- ✅ Global infrastructure (no self-hosting)
- ✅ Built-in recording, analytics, transcription
- ✅ 24/7 support

**Cons:**
- ❌ Vendor lock-in
- ❌ Monthly costs scale with usage
- ❌ Less control over infrastructure

**Cost Estimate (moderate usage):**
- 100 interviews/month × 30 min avg = 3,000 minutes
- Daily.co: 3,000 × $0.005 = **$15/month**
- Agora: 3,000 ÷ 1,000 × $0.99 = **$3/month**

---

### Option B: Premium TURN Providers

| Provider | Pricing | Bandwidth | Reliability |
|----------|---------|-----------|-------------|
| **Xirsys** | $49/month for 50 GB | 50 GB transfer | 99.9% uptime |
| **Twilio TURN** | $0.005/min | Pay-as-you-go | 99.95% uptime |
| **Metered.ca** | $29/month for 50 GB | 50 GB transfer | 99.5% uptime |

**Best for:** Keeping custom WebRTC implementation, outsourcing only TURN.

---

## Implementation Roadmap

### Phase 1: Immediate Wins (1-2 weeks)
- [ ] Add multiple STUN servers (30 min)
- [ ] Enhanced reconnection UI (2-3 hours)
- [ ] Document current connectivity limitations in README (1 hour)

### Phase 2: Core Connectivity (2-4 weeks)
- [ ] Deploy coturn on Render free tier (2-3 hours setup)
- [ ] Test across Jio/Airtel/Vi mobile + WiFi (4-6 hours)
- [ ] Add environment variables for TURN config (1 hour)
- [ ] Update architecture docs with TURN flow (2 hours)

### Phase 3: UX Improvements (1-2 months)
- [ ] Pre-call network diagnostics (6-8 hours)
- [ ] Adaptive bitrate (4-6 hours)
- [ ] Audio-only fallback (3-4 hours)
- [ ] Call quality indicators (3-4 hours)

### Phase 4: Production Readiness (3-6 months)
- [ ] Evaluate Render bandwidth usage vs. paid TURN
- [ ] Add call analytics (12-16 hours)
- [ ] Multi-region TURN (if needed) (8-12 hours)
- [ ] Load testing (50+ concurrent calls)

### Phase 5: Advanced Features (6-12 months)
- [ ] Call recording (legal review + implementation)
- [ ] Email notifications (6-8 hours)
- [ ] Password reset (4-6 hours)
- [ ] Multi-participant rooms (20-30 hours)

---

## Research & Testing Plan

### Connectivity Testing Matrix

| Test Scenario | Current (STUN) | With Render TURN | With Twilio |
|---------------|----------------|------------------|-------------|
| Jio 4G ↔ Jio 4G | To test | To test | — |
| Jio 4G ↔ Airtel 4G | To test | To test | — |
| Jio Fiber ↔ Airtel Xstream | To test | To test | — |
| Mobile ↔ WiFi | To test | To test | — |
| VPN ↔ Regular | To test | To test | — |
| Corporate WiFi ↔ Mobile | To test | To test | — |

**Testing Protocol:**
1. Establish call, measure time-to-connect
2. Monitor video quality (resolution, framerate, packet loss)
3. Test reconnection after network switch
4. Document failure cases

---

## Cost-Benefit Analysis

### Free Tier Path (Render TURN)

| Metric | Estimate |
|--------|----------|
| Setup time | 2-3 hours |
| Monthly cost | $0 |
| Connectivity improvement | 40% → 90-95% |
| Concurrent call limit | 3-5 calls |
| Monthly hour limit | ~50 hours |
| **Best for:** | Portfolio demos, small-scale testing |

### Paid Service Path (Twilio/Agora)

| Metric | Estimate |
|--------|----------|
| Setup time | 1-2 hours |
| Monthly cost | ~$15-50 (100-300 interviews) |
| Connectivity improvement | 40% → 98-99% |
| Concurrent call limit | 100+ calls |
| Monthly hour limit | Pay-as-you-go |
| **Best for:** | Production platform, enterprise clients |

---

## Decision Framework

**Choose Free Render TURN if:**
- ✅ Portfolio/demo project
- ✅ <50 interviews/month
- ✅ Testing with recruiters/friends
- ✅ Learning WebRTC infrastructure

**Choose Paid TURN/Service if:**
- ✅ Production platform with paying users
- ✅ SLA/uptime guarantees needed
- ✅ >100 interviews/month
- ✅ Multi-region user base

---

## Risks & Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Render free tier bandwidth exhausted | Medium | High | Monitor usage, upgrade to $7/month plan |
| TURN cold start during call | Low | Medium | Uptime Robot keeps warm |
| Single point of failure | High | Medium | Add health checks, fallback to STUN-only |
| Cost overrun on paid service | Low | Medium | Set billing alerts, monitor per-call cost |
| Vendor lock-in (Daily.co/Agora) | Medium | Medium | Keep custom WebRTC code, abstract vendor SDK |

---

## Success Metrics

**Current Baseline:**
- Connection success rate: ~40-50% (cross-network)
- Time to establish connection: ~3-5 seconds (same network)
- User complaints: "Video doesn't work on mobile data"

**Target with TURN (Phase 2):**
- Connection success rate: >90% (cross-network)
- Time to establish connection: <8 seconds (including TURN relay)
- User complaints: Minimal for Indian ISPs

**Target with Paid Service (Phase 4):**
- Connection success rate: >98%
- Time to establish connection: <5 seconds
- User complaints: <1% (only extreme edge cases)

---

## References & Further Reading

### WebRTC Fundamentals
- [MDN: WebRTC API](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API)
- [Perfect Negotiation Pattern](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Perfect_negotiation)
- [WebRTC for the Curious](https://webrtcforthecurious.com/) (free book)

### TURN Server Setup
- [coturn GitHub](https://github.com/coturn/coturn)
- [Setting up coturn on AWS/DigitalOcean](https://gabrieltanner.org/blog/turn-server/)
- [Render Deployment Guide](https://render.com/docs/deploy-an-image)

### Commercial Services Documentation
- [Twilio TURN Docs](https://www.twilio.com/docs/stun-turn)
- [Daily.co WebRTC Guide](https://docs.daily.co/guides/products/calls)
- [Agora WebRTC SDK](https://docs.agora.io/en/video-calling/overview/product-overview)
- [100ms Documentation](https://www.100ms.live/docs)

### Performance & Debugging
- [chrome://webrtc-internals](chrome://webrtc-internals) — Chrome's built-in diagnostics
- [WebRTC Troubleshooting](https://bloggeek.me/webrtc-troubleshooting/)
- [Analyzing WebRTC getStats()](https://webrtchacks.com/getstats/)

---

## Appendix A: Technical Deep Dive — Why Connectivity Fails

### NAT Types & WebRTC Compatibility

| NAT Type | How Common | P2P with STUN? | Needs TURN? |
|----------|------------|----------------|-------------|
| **Full Cone** | Rare (5%) | ✅ Yes | ❌ No |
| **Restricted Cone** | Uncommon (15%) | ✅ Yes | ❌ No |
| **Port-Restricted Cone** | Common (30%) | ✅ Yes | ❌ No |
| **Symmetric NAT** | Very common (50%) | ❌ No | ✅ Yes |

**Indian ISPs NAT Behavior:**
- Jio/Airtel/Vi mobile: Symmetric NAT (Carrier-Grade NAT)
- JioFiber/Airtel Xstream home: Symmetric NAT
- ACT Fibernet: Port-Restricted Cone (better!)

**Result:** Most Indian users are behind symmetric NAT → TURN is essential.

---

### What Happens During ICE Negotiation

```
1. Browser gathers ICE candidates:
   - host candidate (local IP: 192.168.x.x)
   - srflx candidate (STUN discovers public IP: 49.x.x.x)
   - relay candidate (TURN allocates relay: turn-server.com:1234)

2. Candidates exchanged via signaling server (Socket.IO)

3. Browser tries candidates in order:
   Priority 1: host → host (same network) — instant
   Priority 2: host → srflx (STUN-assisted) — 1-2 seconds
   Priority 3: relay → relay (TURN) — 2-5 seconds

4. First successful candidate pair wins → media flows
```

**Without TURN:** Only priorities 1-2 available → fails if NAT blocks.

---

## Appendix B: coturn Configuration Template

```conf
# /etc/turnserver.conf — optimized for Render deployment

# Listening ports
listening-port=3478
tls-listening-port=5349
alt-listening-port=3479
alt-tls-listening-port=5350

# Relay addresses (Render assigns public IP dynamically)
listening-ip=0.0.0.0
relay-ip=RENDER_PUBLIC_IP_HERE

# Authentication
lt-cred-mech
user=mockhire:STRONG_PASSWORD_HERE
realm=mockhire.app

# Security
no-cli
no-loopback-peers
no-multicast-peers
stale-nonce=600

# Performance
max-bps=1000000
bps-capacity=0

# Logging
verbose
log-file=/var/log/turnserver.log

# TLS certificates (Let's Encrypt)
cert=/etc/letsencrypt/live/turn.mockhire.app/fullchain.pem
pkey=/etc/letsencrypt/live/turn.mockhire.app/privkey.pem

# Firewall-friendly
fingerprint
```

---

## Appendix C: Client-Side TURN Configuration (Superseded by M11)

**Note:** The static `VITE_TURN_*` client-side configuration originally proposed in this document was superseded by the M11 implementation. M11 securely injects ephemeral, short-lived ICE configurations dynamically via an authenticated backend endpoint. Permanent secrets remain strictly server-side.

---

## Document History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 31 July 2026 | Initial draft — comprehensive WebRTC connectivity roadmap |

---

**Next Steps:**
1. Research TURN deployment options (Render vs. Xirsys vs. Twilio)
2. Test current connectivity across different ISPs (build testing matrix)
3. Prototype coturn on Render staging environment
4. Measure bandwidth usage to validate free tier viability
5. Decide on Phase 2 implementation timeline

**Questions for Decision:**
- Acceptable monthly cost ceiling for TURN infrastructure?
- Expected scale (interviews/month) for next 6-12 months?
- Priority: fastest implementation vs. most cost-effective?
- Requirement for global users or India-focused only?
