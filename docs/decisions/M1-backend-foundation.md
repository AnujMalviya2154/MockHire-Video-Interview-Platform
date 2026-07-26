# Decision Record — M1: Backend Foundation

## D1.1 — JWT in an httpOnly cookie, not localStorage

**Alternatives:** JWT in localStorage (what most tutorials do); server-side sessions (express-session + connect-mongo).
**Decision:** JWT delivered as an `httpOnly`, `SameSite=Lax` cookie, `Secure` in production.
**Why:**
- localStorage is readable by any JavaScript on the page ⇒ a single XSS bug means token theft. An httpOnly cookie is invisible to JS — the browser attaches it automatically, scripts can never read it.
- vs server sessions: JWT keeps the API stateless (horizontal scaling without a shared session store) while the cookie transport gives session-grade browser security.
**Trade-off accepted:** cookies introduce CSRF risk — mitigated by `SameSite=Lax` plus CORS locked to the exact client origin with credentials.

**In short:** "I store the JWT in an httpOnly cookie so XSS can't exfiltrate it, and I handle the resulting CSRF exposure with SameSite and a strict CORS allowlist."

## D1.2 — Real logout revocation via `tokenVersion`

**Problem:** stateless JWTs can't be "deleted" — clearing the cookie doesn't invalidate a stolen copy, which stays valid until expiry.
**Alternatives:** ignore it (most tutorials); a Redis denylist of revoked tokens; short-lived access + refresh token pairs.
**Decision:** each User has a `tokenVersion` integer, embedded in the JWT as `ver`. Logout increments the DB value; `requireAuth` rejects tokens whose `ver` doesn't match.
**Why:** genuine revocation with zero extra infrastructure (no Redis), one integer per user, and it piggybacks on the DB read `requireAuth` already does. Refresh-token pairs add complexity v1 doesn't need.

## D1.3 — No role claim inside the JWT

**Alternatives:** put `role` in the token payload (common practice) and trust it.
**Decision:** the token carries only `sub` (user id) + `ver`; role and every other attribute are read fresh from the DB on each authenticated request.
**Why:** a role inside a token is a *client-held claim* — if a user's role is ever downgraded, an old token would keep the old privileges until expiry. Reading it fresh per-request means authorization state can never be stale. Cost: one indexed `findById` per request — negligible.

## D1.4 — bcrypt cost 12, hash `select: false`

**Decision:** bcryptjs with cost factor 12; the password field excluded from queries by default; comparison via a model method.
**Why:** cost 12 ≈ hundreds of ms per guess — makes offline brute force expensive while login stays fast enough. `select: false` means the hash cannot accidentally leak through a generic `User.find()` serialization; routes must explicitly opt in (`.select("+password")`) exactly where comparison happens.
**Also:** password length capped at 128 chars *before* hashing — prevents CPU-exhaustion via megabyte passwords.

## D1.5 — Layered rate limiting

**Decision:** 300 req/15 min per IP across `/api`; a separate 20 req/15 min limiter on register/login.
**Why:** auth endpoints are the brute-force target — 20 attempts/15 min makes credential stuffing impractical while barely affecting a real user. The general limiter is a blunt DoS backstop. In production, `trust proxy` ensures limits key on the real client IP, not the load balancer's.

## D1.6 — Anti-enumeration login

**Decision:** wrong email and wrong password return the identical `401 "Invalid credentials"`; registration duplicate returns a generic 409.
**Why:** differing errors let an attacker build a list of which emails have accounts (user enumeration). Same-message responses leak nothing.

## D1.7 — express-mongo-sanitize + strictQuery + schema enums

**Threat:** NoSQL injection — e.g. sending `{"email": {"$gt": ""}}` to bypass a login filter.
**Decision:** `express-mongo-sanitize` strips `$`/`.` keys from every request body/query; Mongoose `strictQuery` rejects unknown filter fields; enums whitelist role/status values.
**Why:** three independent layers — even if one is bypassed, the injection has to survive all of them.

## D1.8 — Central error handler, no internal leakage

**Decision:** one error middleware maps Mongoose errors (duplicate key → 409, validation → 400, bad ObjectId CastError → 400) to clean messages; in production, unexpected errors return only `"Internal server error"` while full detail goes to the server log.
**Why:** stack traces and raw DB errors are reconnaissance gold (they reveal schema names, library versions, file paths). Clients get *meaningful but generic* messages; operators get everything.
**Supporting piece:** `asyncHandler` wrapper routes async rejections into this handler — Express 4 doesn't do that natively, and an unhandled rejection would otherwise crash the process.

## D1.9 — Security middleware order in app.js

**Decision:** helmet → CORS → rate limit → body parser (10 kb cap) → cookie parser → sanitizer → routes → 404 → error handler.
**Why:** cheap rejections happen before expensive work: an over-limit IP is bounced before JSON parsing; a 2 MB body is rejected before it allocates; sanitization runs after parsing but before any route logic touches input. Order is deliberate, not decorative.

## D1.10 — http.createServer(app) instead of app.listen()

**Decision:** create the raw HTTP server explicitly.
**Why:** Socket.IO (M3) must attach to the same HTTP server to share the port — and, more importantly, the same cookie context, so the websocket handshake can be authenticated with the exact same JWT validation as REST (`verifyTokenFromCookieHeader` already exists for this).

## D1.11 — Boot-time env validation

**Decision:** the process refuses to start if `JWT_SECRET` is missing or under 32 chars, or if `MONGO_URI` is absent.
**Why:** fail fast and loud at deploy time, not silently at the first login attempt with a weak/missing secret. A short JWT secret would make every token forgeable — that's a config error worth crashing over.
