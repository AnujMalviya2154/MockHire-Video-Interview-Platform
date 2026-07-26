# M6c — Startup Ordering & Readiness

**Commit:** `fix: bind before connecting to Mongo, add readiness gate`

A bug-fix milestone, not a feature. Reported symptom, verbatim from the
Vite dev terminal on every `npm run dev`:

```
6:05:37 pm [vite] http proxy error: /api/auth/me
AggregateError [ECONNREFUSED]: (x2)
6:05:56 pm [vite] http proxy error: /api/auth/login
Error: read ECONNRESET
```

…plus a "Something went wrong" banner shown twice before a sign-in
actually succeeded. Two independent causes, one of which turned out not to
be a defect in this codebase at all.

---

## D6c.1 — Bind the HTTP listener *before* connecting to Mongo

**Decision:** `server/src/index.js` no longer `await`s `connectDB()` at
module top level. It creates the server, attaches Socket.IO, calls
`server.listen(PORT)`, and connects to Mongo **inside the listen
callback**.

**Root cause it fixes:** the old order meant Mongoose dialling Atlas had
to finish before `listen()` was ever reached. Measured on a cold start,
the port refused every TCP connection for **6.5 seconds** (launch
09:38:11.863 → first accepted probe 09:38:20.641; the log confirms
ordering — `MongoDB connected` at 09:38:20.421, then `listening` at
09:38:20.444). The Vite dev proxy boots the client immediately, fires
`GET /api/auth/me`, hits a closed port, and logs `ECONNREFUSED`. Twice,
because React 18 StrictMode double-invokes effects in dev.

**Alternatives considered:** (a) delay the client / add a startup splash —
hides the problem instead of fixing it, and does nothing for a real
deployment behind a load balancer that health-checks immediately;
(b) retry `/me` on the client only — the API would still be a black hole
during boot for every other caller.

**Why:** Connecting after the listener costs nothing. No request can be
served any *sooner* under the old order — the difference is only whether
an early request gets a refused socket or an honest answer. Binding first
also means a container orchestrator's TCP check passes right away, and the
readiness of the *database* is reported separately (D6c.2) instead of
being conflated with liveness of the *process*.

**Result:** bind latency **6.5s → 0.44s**. Cold-starting client and server
together, probes at t+1s…t+6s all returned clean `401`s, and the Vite
terminal logged **zero** proxy errors.

**In short:** "Liveness and readiness are different questions.
Awaiting the DB before `listen()` answers both with a refused socket,
which is the one answer that carries no information."

## D6c.2 — A 503 readiness gate, not a 500 and not a hang

**Decision:** `app.js` gained a small middleware in front of
`/api/auth` and `/api/interviews`:

```js
app.use(["/api/auth", "/api/interviews"], (req, res, next) => {
  if (isDbReady()) return next();
  res.set("Retry-After", "2");
  res.status(503).json({ message: "Server is starting up, try again in a moment" });
});
```

`/api/health` sits **above** the gate and now reports readiness rather
than bare liveness: `{ status: "ok", db: "connected" | "connecting" }`.

**Why 503 specifically:** it is the only status that means "this endpoint
is fine, the server temporarily can't serve it" — and it is the one the
`Retry-After` header is defined for, so a caller can be told *how long*
to wait instead of guessing. A 500 would claim the request was bad or the
code broken and invite a bug report; a 404 would be a lie; letting the
request hang until Mongoose's buffer timeout is the worst option because
the caller can't distinguish it from a dead server.

**Why health stays outside the gate:** health must answer while the DB is
down — that's precisely when someone is asking. Gating it would make the
process look dead during a recoverable DB blip.

**Verified:** during the connecting window, `/api/health` → `200
{"status":"ok","db":"connecting"}` while `/api/auth/me` → `503` with
`Retry-After: 2` and no hang.

**In short:** "The readiness gate is what makes
bind-before-connect honest. Without it you've traded a refused connection
for a confusing 500."

## D6c.3 — Retry the DB connection with backoff; exit only on config errors

**Decision:** `config/db.js` retries `mongoose.connect` with exponential
backoff (1s doubling to a 30s cap, indefinitely). A missing `MONGO_URI`
still `process.exit(1)`s. Also set `bufferCommands: false`.

**Why the split:** an absent `MONGO_URI` is a configuration error that no
amount of retrying can fix — failing loudly and immediately is correct. An
unreachable *server* is transient (Atlas failover, laptop wifi, a DB
restart) and the right response is patience, not suicide. The old code
exited on both, which meant a two-second network blip killed the API and
took the WebRTC signalling layer down with it.

**Why `bufferCommands: false`:** by default Mongoose queues queries issued
while disconnected and resolves them if the connection comes back —
otherwise they reject at an opaque buffer timeout ~10s later. That
interacts badly with a readiness gate: a request that slips through would
hang instead of failing. Failing fast lets the gate turn "DB not ready"
into a clean 503.

**In short:** "Exit on errors that retrying cannot fix; retry
the ones it can. Missing config is the former, an unreachable host is the
latter."

## D6c.4 — `NetworkError` vs `ApiError` on the client

**Decision:** `client/src/lib/api.js` now throws two distinct types. A
`fetch` rejection — or a 5xx with no JSON body, which is the dev proxy's
signature when the upstream died mid-request — becomes `NetworkError`. A
real server response with a status becomes `ApiError`. A `503` is retried
automatically (400ms / 900ms / 1800ms); nothing else is.

**Root cause it fixes:** the "Something went wrong" text was a hardcoded
fallback for *any* non-ok response. It fired on both StrictMode-doubled
`/me` calls, which is literally why the user saw it exactly twice before
signing in.

**Why only 503 is retried:** it is the one status that is *expected* to
clear on its own in a second or two. Retrying a 401 or 400 just repeats a
request the server has already judged; retrying a 500 can duplicate a
side effect.

**Why the type split matters at the UI:** `Login.jsx` surfaces the
server's generic `Invalid credentials` verbatim (kept generic on purpose —
anti-enumeration, see M1) but gives a transport failure its own
actionable copy: "Can't reach the server. Check it's running, then try
again." Mislabelling an unreachable server as a credentials problem sends
the user to reset a password that was never wrong.

**In short:** "`fetch` only rejects on transport failure, never
on a 4xx or 5xx — so 'the request failed' and 'the server said no' are
genuinely different events and deserve different error types."

## D6c.5 — The ECONNRESET was a `node --watch` artifact, not a bug

**Decision:** no code change. Documented instead.

**Investigation:** the leading hypothesis was a stale keep-alive socket
being reused past the server's 5s `keepAliveTimeout`. That was
**disproved** by five independent experiments: a connection-pool probe; an
idle sweep across 1000–9000ms; a rate test at the exact 5s boundary
(0/12 reproductions); and two randomised rigs (0/10, then 0/25 spanning
KA−40ms…KA+5ms). Not one reproduced it.

A timestamped server log then showed the failing login at **09:43:17.201**
coinciding exactly with `Restarting 'src/index.js'` — the request was
never served because the process restarted mid-flight. Tracing *why* it
restarted: an idle run produced 0 restarts; a run with one login produced
1 restart 170ms later, which looked damning; a `bcryptjs` lazy
`require("crypto")` theory was disproved by an isolated harness (0
restarts); `fs.watch` instrumentation recorded no filesystem events from
the app itself. Repeating the login run verbatim then produced **0
restarts** — non-reproducible. Correlating clocks showed the restarts
lined up with *my own edits to `app.js` and `db.js`* being written while
`node --watch` was live.

**Conclusion:** `node --watch` restarts on file change; a restart during
an in-flight request surfaces to the Vite proxy as `read ECONNRESET`. In
normal use that means an editor save — a dev-only artifact of the watch
flag, not a defect. Requests sent straight to port 5000 were always clean.

**Why it's still worth writing down:** D6c.4 makes this failure mode
degrade honestly — a mid-request restart now reports "can't reach the
server" instead of a misleading error — and the discipline of disproving
a plausible hypothesis before shipping a fix for it is the actual lesson.

**In short:** "My best hypothesis was wrong and five
experiments said so. The log timestamps showed the server restarting
mid-request, and the restarts were my own file saves — `--watch` doing
exactly its job."

## D6c.6 — `react-router-dom` 6.30.4 → 7.18.1, with residual risk documented

**Decision:** upgraded to 7.18.1. `npm audit --omit=dev` is **not** clean;
this is a deliberate, documented exception rather than a passing gate.

**Why no clean version exists:** the advisory ranges cover every published
release. `6.0.0 – 7.17.0` (two moderate advisories) and `7.12.0 – 8.2.0`
(one high) overlap, and the patched **8.3.0 is not published** — npm
`latest` is 7.18.1. `npm audit fix --force` proposes 7.11.0, which merely
moves back into the other range. There is no version to upgrade to.

**So the decision is about reachability, not severity:**

| Version | Advisory | Reachable here? |
|---|---|---|
| 6.30.4 | open redirect via backslash in `<Link>` / `useNavigate` | **potentially** — both APIs are used |
| 6.30.4 | arbitrary constructor injection via `deserializeErrors()` (SSR hydration) | no — no SSR |
| 7.18.1 | RSC-mode CSRF bypass | no — advisory states it "only affects your application if you are using the unstable RSC APIs" |

7.18.1 carries the louder *label* (high vs moderate) but strictly fewer
**reachable** advisories: its single issue is confined to `unstable_` RSC
code paths that a client-only `BrowserRouter` SPA cannot invoke, whereas
the 6.x open-redirect concerns APIs this app calls on every navigation.
Audited independently: all 20 navigation targets in `src/` are hardcoded
literals except one interpolation of a server-issued `roomCode`, so the
open redirect is not *currently* exploitable either — but "no
attacker-controlled URL today" is a property a future feature can silently
break, whereas "we don't use RSC" is a structural fact about a client-only
SPA.

**Migration cost:** zero. v7 in library mode is v6.30 with the future
flags on; the API surface in use (`BrowserRouter`, `Routes`, `Route`,
`Navigate`, `Link`, `useNavigate`, `useLocation`, `useParams`) is
unchanged, and the app uses no data-router APIs (`createBrowserRouter`,
loaders, `json()`, `defer()`, `useFetcher`, `Form`). No source file
changed — only `package.json` / lockfile.

**Verification note worth keeping:** the first browser pass after
installing v7 was invalid. Vite's prebundle cache in `node_modules/.vite`
still held the v6 build (file dated Jul 18), so the browser was running
v6 while `node_modules` held v7. The tell was React Router **v6-only
future-flag warnings** still in the console — v7 doesn't emit them.
Clearing `.vite` and restarting the dev server made the warnings
disappear, which is what actually proved v7 was loaded. Re-verified after
that: `Link` navigation, the `PublicOnly` `<Navigate>` guard, logout via
`useNavigate`, and a first-try login all worked; console clean.

**Revisit when:** `react-router` 8.3.0 publishes — then upgrade and the
audit goes clean with no reachability argument required.

**In short:** "Every published version of the dependency was in
some advisory range, so I couldn't patch my way out. I picked the version
whose only advisory was structurally unreachable for a client-side SPA,
documented why, and left a revisit trigger — severity labels rank
advisories, they don't rank *your* exposure."

---

## Security / quality review

- **Startup:** no secret, credential, or PII added to any log. The retry
  message includes `err.message` (may carry a cluster hostname —
  operational detail, not user data) and is the single most useful thing
  for diagnosing a bad URI.
- **Readiness gate:** sits *before* the route handlers, so it cannot leak
  data; the 503 body is a fixed string with no request echo.
- **Error taxonomy:** client-side only; no change to what the server
  discloses. `Invalid credentials` stays generic (anti-enumeration
  preserved). Rate limits, CORS, helmet, `mongoSanitize`, cookie flags,
  and `tokenVersion` revocation all untouched.
- **Tests:** `server/tests/m6c-startup.test.mjs` added — RED (0/3) before
  the fix, GREEN (3/3) after. It asserts the port accepts connections,
  binds inside 1500ms, and the process survives an unreachable DB. Uses
  `203.0.113.1` (RFC 5737 TEST-NET-3, guaranteed unroutable) so it never
  touches the network.
- **Regression:** M2 27 passed, M3 22 passed, M6c 3 passed — **52 total,
  0 failed**. Client production build clean (93 modules, 1.24s).
- **Audit:** server **0 vulnerabilities**. Client 2 high in
  `react-router`, accepted with documented reachability analysis and a
  revisit trigger (D6c.6) — the only open exception in the project.
