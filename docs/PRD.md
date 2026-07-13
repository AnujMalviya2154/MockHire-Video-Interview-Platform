# Product Requirements Document — Video Interview Platform

**Project:** MockHire — Real-Time Video Interview Platform (MERN Stack)
**Author:** Anuj Malviya
**Version:** 1.0
**Date:** 13 July 2026
**Status:** Draft — pending approval

---

## 1. Overview

### 1.1 Problem Statement
Remote technical hiring needs a single tool where an interviewer can schedule an interview, meet the candidate over secure video, evaluate them with a live coding exercise, and record structured feedback. Teams currently stitch this together from Zoom + a shared doc + email, losing security, structure, and an audit trail.

### 1.2 Solution
A self-contained web platform where:
- **Interviewers** schedule interviews, conduct them over WebRTC video with chat, screen share and a live collaborative code editor, and submit structured feedback.
- **Candidates** see their upcoming interviews, join with one click at the scheduled time, and view their result status.

### 1.3 Goals
| Goal | Metric |
|---|---|
| Secure meeting access | Only the two scheduled participants can ever enter a room |
| Real-time experience | Video/chat/code-sync latency imperceptible on same network |
| Zero third-party lock-in | No paid SDKs; native WebRTC + Socket.IO |
| Demonstrable security | Every OWASP-relevant control documented and explainable |

### 1.4 Non-Goals (v1)
- Recording of calls
- Calls with more than 2 participants
- Code execution/compilation in the editor (sync only)
- Email notifications
- Password reset flow

---

## 2. Users & Roles

| Role | Capabilities |
|---|---|
| **Interviewer** | Register/login, schedule interviews (pick candidate by email, set title/time), join own interviews, use all in-call tools, submit feedback (rating 1–5, comments, pass/fail), cancel interviews |
| **Candidate** | Register/login, view own upcoming & past interviews, join own interviews, use in-call video/chat/editor, view own result status |

Role is chosen at registration. A user is exactly one role.

---

## 3. Functional Requirements

### FR-1: Authentication & Accounts
- FR-1.1 Register with name, email, password (min 8 chars), role.
- FR-1.2 Login with email + password; session persists via httpOnly cookie (24 h).
- FR-1.3 Logout clears the session.
- FR-1.4 Duplicate email registration is rejected; login errors never reveal whether the email exists.

### FR-2: Interview Scheduling
- FR-2.1 Interviewer creates an interview: title, optional description, candidate email, date/time (must be in the future).
- FR-2.2 Candidate must be a registered user with role `candidate`; otherwise creation fails with a clear message.
- FR-2.3 Each interview gets a cryptographically random, unguessable room code.
- FR-2.4 Both parties see the interview on their dashboard (upcoming / past, status badge).
- FR-2.5 Interviewer can cancel a scheduled interview.

### FR-3: Interview Room (core)
- FR-3.1 Join is allowed only for the interview's own interviewer and candidate (enforced server-side, per socket connection — not just in UI).
- FR-3.2 1:1 video + audio via WebRTC (peer-to-peer, signaled over Socket.IO).
- FR-3.3 Controls: mute/unmute mic, camera on/off, screen share toggle, leave call.
- FR-3.4 Graceful handling: waiting state until peer joins; notification when peer disconnects.

### FR-4: In-Call Chat
- FR-4.1 Text chat visible to both participants, delivered in real time.
- FR-4.2 Messages are relayed via the socket room only (not persisted in v1); length-capped and rendered as text (never HTML).

### FR-5: Live Code Editor
- FR-5.1 Shared code pad in the room; edits by either party sync in real time.
- FR-5.2 Language label selector (syntax context only; no execution).
- FR-5.3 Content survives peer refresh within the session (last state re-sent on rejoin).

### FR-6: Feedback & Results
- FR-6.1 After (or during) the call, the interviewer submits: rating 1–5, comments, result (pass/fail).
- FR-6.2 Submitting feedback marks the interview `completed`.
- FR-6.3 Candidate sees only the result status (pass/fail/pending) — not the private comments.

---

## 4. Security Requirements (first-class, not an afterthought)

| ID | Threat | Control |
|---|---|---|
| SR-1 | Password theft from DB leak | bcrypt hashing (cost 12); hash excluded from queries by default |
| SR-2 | Token theft via XSS | JWT stored in **httpOnly** cookie — unreadable by JavaScript |
| SR-3 | CSRF | `SameSite=Lax` cookie + CORS locked to the client origin with credentials |
| SR-4 | Brute-force / credential stuffing | Rate limiting: 20 req/15 min on auth routes, general limiter on API |
| SR-5 | NoSQL injection | `express-mongo-sanitize` strips `$`/`.` operators from all input |
| SR-6 | User enumeration | Identical error for wrong email vs wrong password |
| SR-7 | Meeting gate-crashing | 128-bit random room codes; socket-level authorization checks the DB record — only the two scheduled participants may join |
| SR-8 | Unauthorized data access (IDOR) | Every interview query is scoped to `req.user`; role checks on interviewer-only actions |
| SR-9 | XSS via stored/relayed content | All input length-validated & type-checked; React escapes output; chat rendered as text |
| SR-10 | Header-level attacks | Helmet (CSP, X-Frame-Options, nosniff, etc.) |
| SR-11 | Secret leakage | Secrets only in `.env` (gitignored); `.env.example` documents required keys |
| SR-12 | Payload abuse | JSON body size limit (10 kb); field length caps at schema and route level |

---

## 5. Technical Architecture

```
┌─────────────────────────┐         ┌──────────────────────────────┐
│  React 18 + Vite        │  HTTPS  │  Node.js + Express 4         │
│  Tailwind CSS           │◄───────►│  REST: /api/auth, /api/      │
│  React Router           │  REST   │        interviews            │
│                         │         │  Middleware: helmet, CORS,   │
│  WebRTC (RTCPeer-       │         │  rate-limit, sanitize, JWT   │
│  Connection, getUser-   │  WSS    ├──────────────────────────────┤
│  Media, getDisplay-     │◄───────►│  Socket.IO (auth'd)          │
│  Media)                 │ signal/ │  - WebRTC signaling relay    │
│                         │ chat/   │  - chat relay                │
│                         │ code    │  - code-pad sync             │
└─────────────────────────┘         └───────────────┬──────────────┘
                                                    │ Mongoose
                                            ┌───────▼────────┐
                                            │    MongoDB     │
                                            │ users,         │
                                            │ interviews     │
                                            └────────────────┘
```

- **Media path:** peer-to-peer (WebRTC with public STUN). The server only relays signaling — video never touches the backend.
- **Data models:** `User { name, email, password(hash), role }`, `Interview { title, description, interviewer→User, candidate→User, scheduledAt, roomCode, status, feedback{rating, comments, result} }`.

### API Surface
| Method | Route | Auth | Purpose |
|---|---|---|---|
| POST | /api/auth/register | — | Create account |
| POST | /api/auth/login | — | Login, set cookie |
| POST | /api/auth/logout | ✓ | Clear cookie |
| GET | /api/auth/me | ✓ | Current user |
| POST | /api/interviews | ✓ interviewer | Schedule |
| GET | /api/interviews | ✓ | List own (as either role) |
| GET | /api/interviews/:roomCode | ✓ participant | Room details for joining |
| PATCH | /api/interviews/:id/feedback | ✓ owning interviewer | Submit feedback |
| PATCH | /api/interviews/:id/cancel | ✓ owning interviewer | Cancel |

### Socket Events (all inside an authorized room)
`join-room`, `peer-joined`, `signal` (offer/answer/ICE), `chat-message`, `code-change`, `code-language`, `peer-left`.

---

## 6. Milestones & Git Strategy

One commit + push per completed milestone, so the GitHub history itself documents the build.

| # | Milestone | Commit message | Deliverable |
|---|---|---|---|
| M0 | Repo init + PRD | `docs: add PRD and project scaffold` | This document, .gitignore, folder structure |
| M1 | Backend foundation | `feat(server): express app with security middleware, models, JWT auth` | Auth API working, security middleware wired |
| M2 | Interview API | `feat(server): interview scheduling, authorization, feedback endpoints` | Full REST surface |
| M3 | Signaling server | `feat(server): authenticated socket.io signaling with room authorization` | Socket layer with DB-backed join checks |
| M4 | Client foundation | `feat(client): vite app, auth pages, protected routing, dashboard` | Login/register/dashboard against real API |
| M5 | Interview room | `feat(client): webrtc video room with chat, screen share, code editor` | Full in-call experience |
| M6 | Feedback + polish | `feat: feedback workflow, status badges, UX polish` | End-to-end flow complete |
| M7 | Docs + verification | `docs: README with setup, architecture and security notes` | Build verified, README |

**Acceptance for v1:** two browsers on one machine can register (interviewer + candidate), schedule, join the same room, see/hear each other, chat, share screen, co-edit code, submit feedback, and see the result on the candidate dashboard — with an outsider unable to join the room even with the URL.

---

## 7. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| WebRTC fails across strict NATs (no TURN server in v1) | Acceptable for demo/LAN; documented; TURN listed as future work |
| MongoDB not installed locally | Support MongoDB Atlas free tier via `MONGO_URI` |
| Browser blocks camera on http | localhost is exempt from secure-context rule; documented |

## 8. Future Enhancements (v2 backlog)
Recording, TURN server, multi-panel interviews, code execution sandbox, email notifications, password reset, admin analytics dashboard.
