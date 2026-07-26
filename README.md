# MockHire — Real-Time Video Interview Platform

A self-contained platform for conducting technical interviews: schedule an
interview, meet the candidate over peer-to-peer WebRTC video, evaluate them
in a live collaborative code editor, and record structured feedback — with
security treated as a first-class requirement throughout.

Built with the MERN stack. No paid SDKs, no third-party video services:
native WebRTC signaled over Socket.IO.

## Features

**Interviewer** — schedule interviews (candidate by email, title, time),
join over 1:1 video with mic/camera/screen-share controls, chat, co-edit
code in a shared pad, submit feedback (rating 1–5, comments, pass/fail),
cancel interviews.

**Candidate** — see upcoming and past interviews on a dashboard, join with
one click, use all in-call tools, view result status (pass/fail/pending —
never the interviewer's private comments).

**Room security** — every room code is 128 bits of `crypto.randomBytes`;
joining is authorized server-side per socket connection against the
database record. An outsider cannot enter a room even with the full URL.

## Stack

| Layer | Technology |
|---|---|
| Client | React 18, Vite, Tailwind CSS v4, React Router 7, GSAP |
| Server | Node.js, Express 4, Socket.IO 4 |
| Database | MongoDB (Atlas or local), Mongoose 8 |
| Video | Native WebRTC (P2P, DTLS-SRTP), signaled over Socket.IO |
| Auth | JWT in an httpOnly SameSite=Lax cookie, bcrypt-12, token-version revocation |

## Getting started

Prerequisites: **Node.js ≥ 20** and a MongoDB instance (local `mongod` or a
free [MongoDB Atlas](https://www.mongodb.com/atlas) cluster).

```bash
git clone https://github.com/AnujMalviya2154/Video-Interview-Platform.git
cd Video-Interview-Platform

# 1. Server
cd server
npm install
cp .env.example .env    # then edit .env — see below
npm run dev             # API + signaling on http://localhost:5000

# 2. Client (second terminal)
cd client
npm install
npm run dev             # app on http://localhost:5173
```

Configure `server/.env` (never committed — `.gitignore`d from the first
commit):

| Variable | What to set |
|---|---|
| `PORT` | API port (default `5000`) |
| `MONGO_URI` | Your MongoDB connection string |
| `JWT_SECRET` | ≥ 32 chars. Generate: `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"` |
| `CLIENT_ORIGIN` | Client URL for CORS (default `http://localhost:5173`) |
| `NODE_ENV` | `development` or `production` |

The server refuses to start with a missing or short `JWT_SECRET` — a weak
secret makes every token forgeable, so it's treated as a crash-worthy
configuration error rather than a warning.

**Try it end to end:** open two browsers (or one normal + one private
window), register an `interviewer` in one and a `candidate` in the other,
schedule an interview from the interviewer dashboard using the candidate's
email, and join the room from both sides.

In dev, the Vite proxy maps `/api` and `/socket.io` to the server, so the
client and API are same-origin and the auth cookie flows without any
cross-origin setup. The client needs no environment variables and the
bundle contains no server URLs.

**Production** is a single origin: build the client and the server serves
it — static assets, SPA deep links, REST, and websockets all on one port,
which is what keeps the `SameSite=Lax` cookie effective.

```bash
cd client && npm run build     # outputs client/dist
cd ../server
NODE_ENV=production node src/index.js
# app + API on http://localhost:5000
```

In production the server also sends a strict Content-Security-Policy
(computed against the built `index.html` at boot), serves hashed assets
with immutable caching, and disables request logging.

## Architecture at a glance

```
Browser A  ←──────────── WebRTC media (P2P, encrypted) ───────────→  Browser B
    │                                                                    │
    │  REST /api/* (auth, interviews)          Socket.IO /socket.io      │
    └────────────────────┐             ┌────────────────────────────────┘
                         ▼             ▼
                   Express + Socket.IO on one HTTP server (:5000)
                         │  same port, same httpOnly-cookie auth
                         ▼
                      MongoDB (Mongoose)
```

Load-bearing decisions, each argued in full in `docs/`:

- **Video never touches the server.** Media is peer-to-peer over
  DTLS-SRTP; the server only relays signaling (offers/answers/ICE) through
  authorized socket rooms. The server *cannot* see or record calls.
- **One HTTP server for REST and sockets** — the WebSocket handshake
  authenticates with the same httpOnly cookie as REST; no second auth
  scheme, no token in JavaScript.
- **Bind first, connect second.** The API binds its port immediately and
  connects to MongoDB in the background with backoff retry. Until the DB
  is ready, DB-backed routes answer `503` + `Retry-After` (an honest
  "starting up") and `/api/health` reports readiness separately from
  liveness. The client auto-retries 503s, so a cold start resolves
  silently instead of flashing errors.
- **Role is never read from the JWT.** Every request re-reads the user
  from the DB; logout bumps a `tokenVersion` that invalidates every
  previously issued token — real revocation, not just deleting a cookie.

Full walkthrough: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). Every
milestone's choices — including the alternatives that lost and why — are
in [`docs/decisions/`](docs/decisions/).

## Security notes

Security requirements were specified in the PRD before the first line of
code ([`docs/PRD.md`](docs/PRD.md) §4) and tracked against
[`docs/SECURITY-CHECKLIST.md`](docs/SECURITY-CHECKLIST.md) at every
milestone. Highlights:

| Threat | Control |
|---|---|
| Password theft from a DB leak | bcrypt cost 12; hash `select:false` so it never leaves the DB by default |
| Token theft via XSS | JWT in an **httpOnly** cookie — unreadable by JavaScript |
| CSRF | `SameSite=Lax` + CORS locked to `CLIENT_ORIGIN` with credentials |
| Brute force | 20 req/15 min on auth routes; 300 req/15 min general API limit |
| NoSQL injection | `express-mongo-sanitize` + Mongoose `strictQuery` + schema type-checking |
| User enumeration | Identical error for wrong email vs wrong password |
| Room gate-crashing | 128-bit random codes; socket-level DB authorization per join |
| IDOR | Every interview query scoped to the authenticated user; role checks server-side |
| XSS via chat/code | Length caps + React text-node rendering; no `dangerouslySetInnerHTML` anywhere |
| Header attacks | Helmet with a strict CSP in production (inline theme script allowed by hash only), `frame-ancestors 'none'`, nosniff, `x-powered-by` removed |
| Secret leakage | Secrets only via `.env` (gitignored from first commit); `.env.example` documents keys |
| Socket abuse | Handshake auth, per-event rate limiting (30 events/s), payload caps |

Dependency posture: `npm audit --omit=dev` is clean on the server. The
client carries **one documented exception** — `react-router` currently has
no advisory-free published release; the project pins 7.18.1, whose sole
advisory is confined to unstable RSC APIs a client-only SPA cannot invoke.
The reachability analysis and revisit trigger live in
[`docs/decisions/M6c-startup-and-readiness.md`](docs/decisions/M6c-startup-and-readiness.md).

## Tests

```bash
cd server
npm run dev            # tests exercise the live API — start it first
node tests/m2-interviews.test.mjs   # 27 — auth, scheduling, IDOR, feedback privacy
node tests/m3-signaling.test.mjs    # 22 — socket auth, room authorization, rate limits
node tests/m6c-startup.test.mjs     # 3  — binds without DB, survives DB outage
```

The suites run against a real server and a real database (self-cleaning:
they delete every document they create), because the things worth testing
here — cookie flows, socket handshakes, authorization — live in the
integration layer, not in mocked units.

## Project structure

```
client/           React app (Vite)
  src/pages/      Landing, Login, Register, Dashboard, InterviewRoom
  src/components/ UI primitives, room panels, auth layout
  src/context/    AuthContext — mirrors the server session
  src/lib/        api.js (fetch + error taxonomy), rtc.js, socket.js, theme.js
server/           Express + Socket.IO
  src/routes/     auth, interviews (REST)
  src/socket/     signaling, chat, code sync (WebSocket)
  src/models/     User, Interview (Mongoose)
  src/middleware/ auth guard, error handler
  tests/          integration suites
docs/             PRD, architecture guide, security checklist,
                  per-milestone decision records (M0–M7)
```

## Scope notes (v1)

Deliberately out of scope: call recording, >2 participants, code
execution in the editor, email notifications, password reset. Each is
listed in the PRD as a non-goal rather than an omission.

---

**Author:** Anuj Malviya —
[github.com/AnujMalviya2154](https://github.com/AnujMalviya2154)
