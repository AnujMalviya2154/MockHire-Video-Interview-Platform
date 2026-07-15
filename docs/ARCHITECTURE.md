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
│  │ sanitize/jwt      │  │   (planned — M3)   │  │
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
│       └── M1-backend-foundation.md
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
└── client/                     # React SPA (planned — M4/M5)
```

---

## 3. Backend, layer by layer

### 3.1 Boot sequence (`index.js`)
1. Load `.env` (dotenv).
2. **Refuse to start** if `JWT_SECRET` is missing/short — a weak secret makes every token forgeable, so it's a crash-worthy config error.
3. Connect to MongoDB (`config/db.js`); exit on failure (fail fast, not half-alive).
4. Wrap the Express app in `http.createServer` — Socket.IO will attach to this same server in M3, sharing the port *and* the cookie context.

### 3.2 Middleware pipeline (`app.js`) — order is deliberate
```
trust proxy (prod) → helmet → CORS(origin allowlist, credentials)
→ rate limit (/api, 300/15min) → express.json(10kb cap)
→ cookieParser → mongoSanitize → [routes] → 404 → errorHandler
```
Reasoning: reject cheap and early. A rate-limited IP never reaches JSON
parsing; an oversized body never allocates; everything that does get
through is sanitized before any route logic sees it.

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

Design points you should be able to explain:
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

### Design facts to internalize
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

## 6. WebRTC call flow *(planned — M5)*
Offer/answer/ICE sequence diagram, STUN's role, getUserMedia /
getDisplayMedia, and the renegotiation used for screen share.

## 7. Frontend architecture *(planned — M4/M5)*
Route map, auth context, protected routes, API client, and the interview
room component's state machine.

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
| React output escaping, no unsafe HTML | M4/M5 |

---

## 9. Study path (read in this order when the project is done)

1. `docs/PRD.md` — what was built and why those requirements.
2. This file §1–3 — the system shape and the backend.
3. `docs/decisions/M0…M7` — every choice + the alternative that lost.
4. Code order: `index.js` → `app.js` → `models/` → `middleware/auth.js` → `routes/` → `socket/` → client `main.jsx` → room component.
5. `docs/SECURITY-CHECKLIST.md` — then re-read §8 above and check you can explain every row.
