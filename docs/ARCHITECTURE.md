# MockHire — Architecture Guide

> **How to use this document:** this is the study guide for the whole system.
> It is updated at every milestone; sections marked *(planned — M#)* describe
> parts not yet built. Read it alongside `docs/decisions/` (why each choice
> was made) and `docs/PRD.md` (what the product must do).

---

## 1. System Overview

MockHire is a 1:1 video interview platform. Three cooperating layers:

```
┌────────────────────────────────────────────────────────────────────┐
│                            BROWSER                                 │
│  React SPA (Vite + Tailwind)                                       │
│  ┌──────────────┐  ┌───────────────┐  ┌─────────────────────────┐  │
│  │ Auth pages    │  │ Dashboard     │  │ Interview Room          │  │
│  │ login/register│  │ schedule/list │  │ WebRTC video + chat +   │  │
│  │               │  │ feedback      │  │ screen share + code pad │  │
│  └──────┬───────┘  └──────┬────────┘  └───────┬───────┬─────────┘  │
└─────────┼─────────────────┼───────────────────┼───────┼────────────┘
          │ REST (fetch,    │                   │       │ WebRTC media
          │ cookie auth)    │        Socket.IO  │       │ (peer-to-peer,
          ▼                 ▼        (wss)      ▼       ▼  never via server)
┌─────────────────────────────────────────────────┐   ┌───────────────┐
│              NODE.JS BACKEND (one process)      │   │  OTHER PEER   │
│  ┌───────────────────┐  ┌────────────────────┐  │   │  (candidate/  │
│  │ Express REST API  │  │ Socket.IO server   │  │◄──┤  interviewer) │
│  │ /api/auth         │  │ - handshake auth   │  │   └───────────────┘
│  │ /api/interviews   │  │ - room authz       │  │
│  │                   │  │ - signaling relay  │  │
│  │ security stack:   │  │ - chat relay       │  │
│  │ helmet/cors/rate/ │  │ - code-pad sync    │  │
│  │ sanitize/jwt      │  │                    │  │
│  └─────────┬─────────┘  └─────────┬──────────┘  │
│            └───────────┬──────────┘             │
│                        ▼ Mongoose ODM           │
└────────────────────────┼────────────────────────┘
                         ▼
                  ┌────────────┐
                  │  MongoDB   │   collections: users, interviews
                  └────────────┘
```

**The key architectural fact to remember:** there are *three* transport
channels, each carrying different data —

| Channel | Carries | Protected by |
|---|---|---|
| HTTPS REST | auth, scheduling, feedback (persistent data) | JWT cookie + role & ownership checks |
| Socket.IO (wss) | signaling, chat, code sync (ephemeral realtime) | same JWT at handshake + DB-checked room membership |
| WebRTC (SRTP) | audio/video/screen media | peer-to-peer encryption (DTLS-SRTP), never touches our server |

---

## 2. Repository Layout

```
video-interview-platform/
├── docs/
│   ├── PRD.md                  # requirements & milestones
│   ├── ARCHITECTURE.md         # this file
│   ├── SECURITY-CHECKLIST.md   # rules every milestone must satisfy
│   └── decisions/              # one decision record per milestone
│       ├── M0-prd-and-scaffold.md
│       ├── M1-backend-foundation.md
│       ├── M2-interview-api.md
│       ├── M3-signaling-layer.md
│       ├── M4-client-foundation.md
│       ├── M4b-design-pass.md
│       ├── M5-interview-room.md
│       ├── M6-feedback-workflow.md
│       └── M6b-dark-mode.md
├── server/                     # Express + Socket.IO backend
│   ├── package.json
│   ├── .env.example            # documented config (real .env gitignored)
│   └── src/
│       ├── index.js            # entry: env checks → DB → http server
│       ├── app.js              # express app + middleware stack
│       ├── config/db.js        # mongoose connection
│       ├── models/             # User.js, Interview.js
│       ├── middleware/         # auth.js, errorHandler.js
│       ├── routes/             # auth.js, interviews.js
│       ├── socket/             # index.js — auth'd signaling, chat, code sync
│       └── utils/asyncHandler.js
│   └── tests/                  # integration suites (run against live server)
└── client/                     # React SPA — auth, dashboard, WebRTC room
    └── src/
        ├── main.jsx            # routes + guards
        ├── index.css           # design tokens (@theme, OKLCH)
        ├── lib/                # api.js, socket.js, rtc.js, time.js, motion.js
        ├── context/            # AuthContext.jsx
        ├── components/         # ui.jsx primitives, modals, room/ (tiles, controls, panel)
        └── pages/              # Landing, Login, Register, Dashboard, InterviewRoom
```

---

## 3. Backend, layer by layer

### 3.1 Boot sequence (`index.js`) — revised in M6c
1. Load `.env` (dotenv).
2. **Refuse to start** if `JWT_SECRET` is missing/short — a weak secret makes every token forgeable, so it's a crash-worthy config error.
3. Wrap the Express app in `http.createServer` — Socket.IO attaches to this same server, sharing the port *and* the cookie context.
4. Handle the server `error` event: `EADDRINUSE` prints an actionable message and exits; anything else re-throws.
5. **`server.listen(PORT)` — bind first.**
6. **Connect to MongoDB inside the listen callback** (`config/db.js`), retrying with backoff.

**Why 5 before 6 (M6c, D6c.1):** the original order awaited `connectDB()` at
module level, so Mongoose dialling Atlas had to finish before the port
opened — measured at **6.5 seconds** of refused connections on a cold
start, which is why the Vite dev proxy logged `ECONNREFUSED /api/auth/me`
on every client boot. Connecting after the listener costs nothing (no
request could be served sooner either way) and drops bind latency to
**0.44s**. The tradeoff — a window where the process is up but the DB
isn't — is handled explicitly by the readiness gate below, not ignored.

**Failure policy (D6c.3):** a missing `MONGO_URI` exits (config error, no
retry helps). An unreachable host retries with exponential backoff
(1s → 30s cap) so a transient blip doesn't kill the API and take the
signalling layer with it. `bufferCommands: false` makes queries against a
down DB fail fast instead of hanging on Mongoose's buffer timeout.

### 3.2 Middleware pipeline (`app.js`) — order is deliberate
```
trust proxy (prod) → helmet (+ strict CSP in prod) → CORS(origin allowlist, credentials)
→ rate limit (/api, 300/15min) → express.json(10kb cap)
→ cookieParser → mongoSanitize
→ /api/health (ungated)
→ readiness gate (503 on /api/auth, /api/interviews)
→ [routes] → static client + SPA fallback (prod) → 404 → errorHandler
```
Reasoning: reject cheap and early. A rate-limited IP never reaches JSON
parsing; an oversized body never allocates; everything that does get
through is sanitized before any route logic sees it.

**Production serving (D7.4).** With `NODE_ENV=production`, the same
Express server serves `client/dist`: hashed assets get
`Cache-Control: immutable` (a year), `index.html` gets `no-cache`, and
any unknown non-`/api` path falls through to `index.html` so the client
router owns deep links (`/room/:code`). Unknown `/api` paths still 404
as JSON. One origin means the `SameSite=Lax` cookie keeps doing CSRF
work in production exactly as in dev — split hosting would force
`SameSite=None` and CORS loosening. The production CSP is computed at
boot: the server hashes the inline scripts actually present in the built
`index.html` (there is exactly one — the pre-paint theme snippet), so
editing that script can never silently break the policy or vice versa.

**Readiness contract (D6c.2).** Because the listener now precedes the DB
connection, DB-backed routes need an honest answer during startup:

| Endpoint | DB connecting | DB connected |
|---|---|---|
| `GET /api/health` | `200 {status:"ok", db:"connecting"}` | `200 {status:"ok", db:"connected"}` |
| `/api/auth/*`, `/api/interviews/*` | `503` + `Retry-After: 2` | normal handling |

`/api/health` deliberately sits **above** the gate — health must answer
precisely when the DB is down, since that's when someone is asking. It
reports readiness (`db:`) separately from liveness (`status:`) so an
orchestrator can distinguish "process alive" from "ready for traffic".

503 is the correct status, not 500: it means "this endpoint is fine, the
server temporarily can't serve it", and it's the status `Retry-After` is
defined for. The client retries a 503 automatically (§7) — and *only* a
503.

### 3.3 Data models

**User** (`models/User.js`)
| field | notes |
|---|---|
| name, email | validated, length-capped; email unique + lowercased |
| password | bcrypt-12 hash; `select:false` so it never leaves the DB by default |
| role | enum: `candidate` \| `interviewer` — fixed at registration |
| tokenVersion | int; bumped on logout ⇒ all previously issued JWTs die |

Hashing lives in a `pre("save")` hook — impossible to create/update a user
with a plain-text password, no matter which route does it.

**Interview** (`models/Interview.js`)
| field | notes |
|---|---|
| title, description | length-capped |
| interviewer, candidate | ObjectId refs → User, both indexed |
| scheduledAt | Date |
| roomCode | `crypto.randomBytes(16).hex` — 128-bit unguessable, unique |
| status | enum: scheduled / completed / cancelled |
| feedback | rating 1–5, comments, result enum (pending/pass/fail) |

### 3.4 Authentication flow

```
REGISTER/LOGIN                          EVERY PROTECTED REQUEST
──────────────                          ───────────────────────
validate input                          read iv_token cookie
   │                                        │
find/create user (bcrypt compare/hash)  jwt.verify(secret, iss, aud)
   │                                        │
sign JWT {sub, ver} 24h                 User.findById(payload.sub)
   │                                        │
Set-Cookie: iv_token=…;                 payload.ver === user.tokenVersion?
  httpOnly; SameSite=Lax;                   │ yes            │ no
  Secure(prod)                          req.user = user   401 (revoked)
```

Design points worth calling out:
- **httpOnly cookie** ⇒ JS can't read the token ⇒ XSS can't steal it. The CSRF exposure this creates is countered by SameSite=Lax + strict CORS.
- **No role in the JWT** — role is read fresh from the DB every request; client-held claims are never trusted for authorization.
- **tokenVersion** — logout is *real* revocation, not just deleting the client's copy.
- **Anti-enumeration** — login never reveals whether the email or the password was wrong.

### 3.5 Error handling
All async route handlers are wrapped (`asyncHandler`) so rejections land in
one central `errorHandler`, which maps Mongoose errors to clean HTTP codes
(11000→409, ValidationError→400, CastError→400) and — in production —
collapses unexpected errors to a bare 500 with details only in server logs.

---

## 4. Interview API — ✅ built in M2

All routes under `/api/interviews` sit behind `requireAuth` (router-level
`router.use`). Full decisions in `docs/decisions/M2-interview-api.md`.

| Method | Route | Who | Purpose |
|---|---|---|---|
| POST | `/` | interviewer | Schedule: title, candidateEmail → resolved server-side, future date |
| GET | `/?page&limit&status` | any participant | Own interviews, paginated (limit ≤ 50), newest first |
| GET | `/room/:roomCode` | participant only | Join-time lookup; 404 for outsiders, 410 if cancelled |
| PATCH | `/:id/feedback` | owning interviewer | rating 1–5 + comments + pass/fail ⇒ status `completed` |
| PATCH | `/:id/cancel` | owning interviewer | Only from `scheduled` state |

### The four load-bearing patterns

**1. Ownership scoping in the query (IDOR-proof by construction)**
```js
// not: findById(id) then check — the check can be forgotten
Interview.findOne({ _id: id, interviewer: req.user._id })
// list: only ever what you belong to
{ $or: [{ interviewer: me }, { candidate: me }] }
```
An unauthorized document is *invisible*, not *forbidden* — so probing ids
returns 404, identical to a missing id (no existence leak).

**2. Identity from the session, never the body.** `interviewer` is always
`req.user._id`; the candidate is chosen by email and resolved/validated
server-side (must exist, must have candidate role, can't be yourself).

**3. Viewer-dependent response shaping.** `shapeForViewer()` strips
`feedback.rating`/`comments` for candidates — they see only
pass/fail/pending. Privacy enforced at serialization, not in the UI.

**4. Status state machine.** `scheduled → completed | cancelled`, nothing
else; invalid transitions → 409. Impossible states are unrepresentable.

### Testing
`server/tests/m2-interviews.test.mjs` — 27 integration assertions against
the live server + Atlas: every role gate, every validation branch, IDOR
probes by a third "outsider" user, feedback privacy from both viewpoints,
state-machine violations, anonymous access. Self-cleaning.

## 5. Realtime layer — ✅ built in M3

`server/src/socket/index.js`, attached to the same HTTP server as Express
(same port ⇒ same origin ⇒ the httpOnly JWT cookie rides the websocket
handshake automatically). Full decisions in
`docs/decisions/M3-signaling-layer.md`.

### Connection lifecycle

```
connect ──► io.use middleware ──► verifyTokenFromCookieHeader()
                │ fail: handshake refused ("unauthorized")
                ▼ ok: socket.user = {id, name, role}   (server-verified)
"join-room"(roomCode, ack)
                │ regex-validate code → load Interview from DB
                │ caller must BE interviewer or candidate  (else "not found")
                │ cancelled? refused · 2 distinct users max (refresh OK)
                ▼
        socket joins room; peer gets "peer-joined";
        joiner's ack carries current code-pad state (refresh resync)
                │
   ┌────────────┼──────────────┬───────────────┐
   ▼            ▼              ▼               ▼
"signal"    "chat-message"  "code-change"  "code-language"
relay SDP/  relay text      sync pad       whitelist enum
ICE to peer (≤1000 chars,   (≤50kb, drop   (js/py/java/
(opaque)    truncate)       if over)       cpp/plaintext)
   └────────────┴──────────────┴───────────────┘
        all wrapped in inRoom() guard — no authorized room, no relay
                │
"disconnect" ──► peer gets "peer-left"; participant removed only when
                 their last socket closes; last-one-out deletes room state
```

### Load-bearing design facts
- **One auth path:** the socket handshake uses the *same* verify function
  as REST (incl. tokenVersion revocation) — a logout kills sockets' auth too.
- **Two gates, not one:** unguessable room code (possession) AND DB-checked
  membership (identity). A leaked link is useless to a non-participant.
- **The server introduces, browsers talk:** SDP/ICE relayed opaquely;
  media is peer-to-peer DTLS-SRTP — the server cannot see calls.
- **Per-socket token bucket** (30 events/s) + 100 kb packet cap: the
  websocket is not an unthrottled side channel around M1's HTTP limits.
- **Ephemeral by design:** chat/pad state live in a Map, resynced on
  refresh, deleted when the room empties. The durable record is M2's
  feedback, not the conversation.

### Testing
`server/tests/m3-signaling.test.mjs` — 22 assertions with real
socket.io-client connections: anonymous handshake refusal, outsider
rejection (indistinguishable from missing), relay scoping, chat
truncation + HTML-as-text, language whitelist, refresh resync, room-less
event dropping, post-cancellation lockout. Self-cleaning.

## 6. WebRTC call flow — ✅ built in M5

`client/src/lib/rtc.js` (native RTCPeerConnection, no library) +
`client/src/pages/InterviewRoom.jsx`. Full decisions in
`docs/decisions/M5-interview-room.md`.

### The call, end to end

```
INTERVIEWER (impolite)          SERVER (M3 relay)          CANDIDATE (polite)
────────────────────            ─────────────────          ──────────────────
getUserMedia (lobby preview)                               getUserMedia
"join-room" ──────────────────► authorize vs DB ◄────────── "join-room"
                                relay only between
                                the two participants
        ◄──── "peer-joined" ────┘
ensurePeer(): addTrack(mic,cam)                            ensurePeer()
onnegotiationneeded fires
setLocalDescription()
{description: offer} ─────────► relay ────────────────────► setRemoteDescription
                                                           setLocalDescription()
setRemoteDescription ◄───────── relay ◄─────────────────── {description: answer}
{candidate: ICE} ◄────────────► relay (both ways, opaque) ◄─► {candidate: ICE}
        │                                                          │
        └────────── DTLS-SRTP media, peer-to-peer ────────────────┘
                    (audio+video never touch the server)
```

- **STUN, not TURN (D5.3):** one public STUN server discovers each peer's
  public address; media then flows directly. No relay server in v1 —
  symmetric-NAT pairs are a documented limitation.
- **Perfect negotiation (D5.2):** both sides may offer at once (glare) —
  the *polite* peer (candidate, derived from role) rolls back and answers;
  the *impolite* peer (interviewer) ignores the colliding offer. Same
  machinery absorbs every mid-call renegotiation.
- **Screen share (D5.4):** `getDisplayMedia` grabs the screen, then
  `RTCRtpSender.replaceTrack()` swaps what the existing video sender
  transmits — no second track, no second connection. Camera-less
  participants flip their recvonly video line to sendrecv for the
  duration. The browser's own "Stop sharing" bar is honored via the
  track's `onended`.
- **Presence & mute (D5.5):** mic/cam/share state rides the signal relay
  as `{meta}` payloads — opaque to the server, authorized like everything
  else. Mute disables tracks (`enabled=false`), it never stops them, so
  unmute is instant and needs no renegotiation.
- **One media lifecycle (D5.6):** the room page owns the stream; lobby
  preview, peer connection and self-view all share it, and every exit
  path (leave, unmount, fatal loss) runs the same teardown — stop tracks,
  destroy peer, drop socket.
- **Reconnect (D5.7):** a reconnected socket is a stranger to the server,
  so the client re-runs `join-room` (re-authorization + pad resync) and
  re-announces meta; terminal loss tears down and fails loudly.

### The room UI (D5.1, D5.8)
Three phases on one route: **lobby** (device preview + pre-toggles) →
**live** (peer stage, corner self-view, control bar, chat/code side
panel) → **ended**. The code pad is deliberately a textarea — sync only
per FR-5, no editor dependency, no parsing surface (D5.1). Controls are
keyboard-first (M/V/C shortcuts, suppressed while typing), leave is
two-press, and every network state renders honestly (waiting /
connecting / reconnecting / muted badges / "you're presenting").

## 6b. Feedback workflow — ✅ built in M6

The product loop closes client-side on M2's API (zero server changes).
Full decisions in `docs/decisions/M6-feedback-workflow.md`.

```
call ends (interviewer leaves)
   │  ended screen: "Write feedback" primary / "Later" secondary   (D6.1)
   ▼  navigate("/dashboard", { state: { feedbackFor: id } })
dashboard loads list ──► opens FeedbackModal for that id, clears state
   │  rating 1-5 + pass/fail + private comments
   ▼  PATCH /interviews/:id/feedback  (M2: owning interviewer only)
status → completed
   ├─ interviewer row: verdict badge + "Edit feedback"
   └─ candidate row:   verdict badge only — server ships {result} alone
                       (shapeForViewer strips rating/comments, M2)
```

Key facts:
- **"Unreviewed" is a derived state (D6.2):** the server can't know a
  call happened (media is P2P), so *past + still `scheduled`* = feedback
  owed. Greeting shows the debt count; rows read "feedback due"
  (interviewer) / "awaiting result" + pending badge (candidate).
- **Offer vs enforce (D6.3):** the UI offers feedback only on past rows;
  the API accepts it any time after scheduling (rating a no-show is
  legitimate). Client curates, server validates.
- **Completed rooms stay open, cancelled rooms don't (D6.4):**
  cancellation is an enforced "don't meet" (410 + socket lockout);
  completion just means the verdict is recorded — the lobby says so.


## 7. Frontend architecture — ✅ foundation built in M4

`client/` — React 18 + Vite + Tailwind v4. Full decisions in
`docs/decisions/M4-client-foundation.md`.

### Route map (`src/main.jsx`)
```
/                Landing (public, GSAP entrance, reduced-motion aware)
/login           GuestOnly ─┐  logged-in users bounce to /dashboard
/register        GuestOnly ─┘  (role picker: candidate | interviewer)
/dashboard       Protected — upcoming/past lists, schedule/cancel/feedback
/room/:roomCode  Protected — lobby → live WebRTC room (M5): video, chat,
                 screen share, shared code pad
*                → /
```
Guards render nothing until the initial `GET /auth/me` resolves — no
flash of the wrong page, no client-side auth guessing.

### Data flow
```
components → lib/api.js (single fetch wrapper, credentials:"include",
             ApiError / NetworkError normalization + 503 retry — NO token
             handling: cookie is httpOnly, invisible to JS by design)
           → AuthContext (mirrors /auth/me; login/register/logout)
```
Vite dev proxy maps `/api` + `/socket.io` → :5000, so dev is same-origin
and the cookie flows naturally; the bundle contains no server URLs.

**Error taxonomy (M6c, D6c.4).** `lib/api.js` throws two distinct types,
because "the request never arrived" and "the server said no" are different
events needing different UI:

| Thrown | When | UI treatment |
|---|---|---|
| `NetworkError` | `fetch` rejected (proxy refused, server restarting, offline), or a 5xx with no JSON body | "Can't reach the server. Check it's running, then try again." |
| `ApiError(status, message)` | a real response with a status | server's message verbatim (e.g. `Invalid credentials`) |

`fetch` only rejects on transport failure — never on a 4xx/5xx — which is
exactly why the distinction has to be made explicitly.

**Retry policy:** `503` only, at 400/900/1800ms. It's the one status
expected to clear by itself (the readiness gate during startup, §3.2).
Retrying a 401/400 just repeats a request the server already judged;
retrying a 500 risks duplicating a side effect. This is why a cold start
now resolves silently in `AuthContext`'s bootstrap `/me` instead of
flashing an error on first paint.

### Design system — redesigned in the M4b design pass
Two visual registers sharing one token system (`index.css` `@theme`, all
colors OKLCH at hue 278 — see `docs/decisions/M4b-design-pass.md`):

| Register | Where | Character |
|---|---|---|
| **Brand** (dark) | Landing, auth brand panel, room | `night-*` surfaces, Bricolage Grotesque display type, glow/grain, entrance motion |
| **Product** (light *or dark*) | Dashboard, forms, modals | `ink-*` neutrals, `surface` for raised elements, Inter, state-driven motion only |

**Dark mode (M6b):** a token remap, not a component rewrite. The same
`@theme` variables are reassigned under `:root[data-theme="dark"]` and
under `prefers-color-scheme: dark` for users with no explicit choice —
components keep consuming `bg-surface` / `text-ink-900` / `text-*-strong`
and those tokens resolve per theme (D6b.1). Only the **product register**
themes; `night-*`, accent fills and `live-500` are constant, so landing
and room look identical in both modes (D6b.2). Key supporting tokens: a
`surface` role split from the page background (white ↔ lifted charcoal,
D6b.3) and a `*-strong` text-on-tint role split from the `*-500/600`
fills so status chips keep AA contrast in both modes (D6b.4). The choice
is applied by a pre-paint inline script in `index.html` (no flash),
persisted in `localStorage` (never a cookie — the server has no say),
and defers to the OS until the user toggles (D6b.5). Toggle lives in
`components/ui.jsx`; logic in `lib/theme.js`.

Supporting tokens: semantic ok/warn/bad states, a dedicated `live-500`
green ("on air" ≠ accent), two exponential ease-out curves, semantic
z-scale. Consumed by the primitives in `components/ui.jsx` plus the shared
`AuthLayout` shell (login/register: brand panel with a live-call vignette
beside the form). No component library, no new dependencies — deliberate
(D4.4, D4b.7). All motion is `prefers-reduced-motion` aware.

**Motion vocabulary (D4b.8):** the two registers animate differently.
Brand surfaces earn *entrance* choreography — the landing hero's word-rise
with blur settle (GSAP timeline), ScrollTrigger reveals on feature rows,
magnetic pull on primary CTAs (`gsap.quickTo`, no React state per
pointer-move), staggered seat-tile entrances in the room lobby and the
auth panel vignette (`useGSAP` for StrictMode-safe cleanup). Product
surfaces get *state* motion only: 150–250ms transitions on hover, focus,
selection and disclosure, and never a page-load sequence. Every tween is
gated behind `prefers-reduced-motion: reduce`.

### Security posture in the client
- Role checks in UI are *presentation only* — server enforces (e.g. the
  Cancel button is interviewer-only in UI, but the API would 403 anyway).
- All user content rendered as React text nodes; no dangerouslySetInnerHTML.
- Errors surface the server's generic messages verbatim; nothing invented.
- Verified E2E in a real browser incl. feedback privacy (candidate's
  API payload carries only `{result}`) and room-URL probing (404/401).

---

## 8. Security model — cross-reference

Every control maps to a requirement in `docs/PRD.md` §4 (SR-1…SR-12) and a
rule in `docs/SECURITY-CHECKLIST.md`. Current implementation status:

| Control | Status |
|---|---|
| bcrypt-12 password hashing, select:false | ✅ M1 |
| httpOnly SameSite JWT cookie, iss/aud claims | ✅ M1 |
| Logout revocation (tokenVersion) | ✅ M1 |
| Rate limiting (general + auth-tight) | ✅ M1 |
| NoSQL-injection sanitization (3 layers) | ✅ M1 |
| Anti-enumeration auth errors | ✅ M1 |
| Central error handler, zero internal leakage | ✅ M1 |
| Payload cap 10 kb, length caps everywhere | ✅ M1 |
| Helmet headers, x-powered-by removed, trust proxy | ✅ M1 |
| Secrets only via env; .env gitignored from first commit | ✅ M0 |
| Unguessable room codes | ✅ M1 (model) — REST join gate ✅ M2; socket gate M3 |
| Ownership-scoped queries (IDOR) | ✅ M2 |
| Feedback privacy (viewer shaping) | ✅ M2 |
| Pagination + capped limits + covering indexes | ✅ M2 |
| Socket handshake auth + room authorization | ✅ M3 |
| Socket event rate limiting + payload caps | ✅ M3 |
| React output escaping, no unsafe HTML | ✅ M4 — room UI (chat, code, names) completed in M5 |
| Client holds no secrets / no token in JS | ✅ M4 |
| P2P media (DTLS-SRTP), server never sees calls | ✅ M5 |
| Complete media teardown on every exit path | ✅ M5 |
| Feedback privacy exercised through the real UI, both roles | ✅ M6 |
| Dark mode: no new deps/secrets, AA contrast both themes | ✅ M6b |
| Readiness gate: 503 not 500, no request echo in body | ✅ M6c |
| Startup logs carry no secret/credential/PII | ✅ M6c |
| Prod: single-origin static serving, strict CSP (hash-pinned inline script), immutable asset caching | ✅ M7 |
| `npm audit --omit=dev` clean | ✅ server (0 vulns) — ⚠️ client: 1 accepted exception, see below |

**Open exception — the only one in the project.** `react-router` has no
clean published version: advisory ranges `6.0.0–7.17.0` and `7.12.0–8.2.0`
overlap to cover every release, and the patched 8.3.0 is unpublished. The
project runs **7.18.1**, whose sole advisory is confined to `unstable_` RSC
APIs that a client-only `BrowserRouter` SPA cannot invoke — strictly fewer
*reachable* advisories than 6.30.4, whose open-redirect issue concerns
`<Link>`/`useNavigate`, APIs this app calls on every navigation. Full
reachability analysis and revisit trigger: `docs/decisions/M6c-startup-and-readiness.md`
(D6c.6). **Revisit when 8.3.0 publishes.**

---

## 9. Reading order (for anyone new to the codebase)

1. `docs/PRD.md` — what was built and why those requirements.
2. This file §1–3 — the system shape and the backend.
3. `docs/decisions/M0…M7` — every choice + the alternative that lost.
4. Code order: `index.js` → `app.js` → `models/` → `middleware/auth.js` → `routes/` → `socket/` → client `main.jsx` → room component.
5. `docs/SECURITY-CHECKLIST.md` — then re-read §8 above; every row maps to code.
