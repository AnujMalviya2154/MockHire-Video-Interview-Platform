# M8 — First Login Bug Investigation

**Commit:** `chore(diagnostics): add high-resolution structured logging for startup bug investigation`

A bug-investigation milestone. Reported symptom:

> 100% reproducible: After stopping both client and server, starting them, and attempting to log in, the *first* login attempt always fails. Immediately trying again with exactly the same credentials succeeds. Every login after the first succeeds normally.

---

## D8.1 — Evidence collection before logic changes

**Decision:** Before modifying any application logic or guessing the fix, high-resolution structured logging was added across both the client and server.

**Root cause it aims to find:** The first-login failure could be caused by several factors, primarily:
1. **Readiness Gate Timing:** The client might be firing `/api/auth/login` right as the server boots, hitting the 503 readiness gate (introduced in M6c) before the database connection succeeds.
2. **Database Cold Start:** The first query (`User.findOne`) might fail if the Mongoose connection pool isn't fully ready despite the readiness gate being open.
3. **Vite Proxy Cold Start:** The Vite development proxy might be dropping the first request while initializing.

**Alternatives considered:** 
(a) Adding arbitrary retry logic to the login function — this would mask the bug instead of solving it and would worsen the UX.
(b) Guessing and modifying the readiness gate or connection logic — this introduces risk of breaking the carefully designed startup lifecycle (M6c) without proof.

**Why:** Guessing the root cause often leads to masking the problem. By instrumenting the exact execution timeline with high-resolution timestamps (`performance.now()`) and an end-to-end correlation ID (`X-Debug-Request-Id`), we can definitively prove which component fails on the first request and why the second request succeeds. 

**Result:** The application now logs:
- `X-Debug-Request-Id` headers bridging the browser, Vite proxy, and Express server.
- High-resolution `performance.now()` timestamps for React mounts and API fetches.
- Granular server events tracking the `listen` callback, database connection lifecycle, readiness gate, auth middleware, and error handler.
- **No application logic, execution order, or async scheduling was changed**, ensuring the bug remains 100% reproducible while generating evidence.

**In short:** "Move from reasoning to evidence. Instrument the system to reconstruct the exact timeline before attempting a fix."

---

## Security / quality review

- **Data Privacy:** Instrumentation logging strictly avoids logging passwords, JWTs, or PII. It only records request IDs, timestamps, filenames, and function entry/exit events.
- **Side-Effects:** Logging uses synchronous string operations and standard `console.log()`/`performance.now()` to guarantee that we do not alter async scheduling or introduce "Heisenbugs" that would hide the issue we are trying to measure.
- **Rollback:** These diagnostic logs are prefixed and temporary. They are designed to be easily stripped out once the root cause is identified and the actual fix is implemented.
