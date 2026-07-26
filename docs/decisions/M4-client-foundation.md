# Decision Record — M4: Client Foundation

## D4.1 — Dev proxy so client and API are same-origin

**Alternatives:** call `http://localhost:5000` cross-origin from the client
(CORS + cookie SameSite friction in dev); put the API URL in an env var.
**Decision:** Vite dev proxy forwards `/api` and `/socket.io` to the
backend; the client only ever uses relative paths.
**Why:** the httpOnly cookie "just works" when everything is same-origin —
no CORS preflights in dev, no hardcoded URLs in the bundle, and production
can serve the built client from the same domain with zero code change.
The client contains no server addresses and no secrets of any kind.

## D4.2 — One fetch wrapper, zero token handling in JS

**Decision:** `lib/api.js` is the single HTTP entry point:
`credentials: "include"` on every call, JSON errors normalized to an
`ApiError {status, message}`.
**Why:** the auth token *cannot* appear in client code (it's httpOnly —
JS can't read it), so there is no token plumbing to get wrong. Components
never call fetch directly, so error shape and cookie behaviour are
consistent by construction — one place to audit, not thirty.

## D4.3 — AuthContext mirrors the server, never decides

**Decision:** a context provider calls `GET /auth/me` once on mount;
`login/register/logout` update the mirror. Route guards (`Protected`,
`GuestOnly`) render nothing until that first check resolves.
**Why:** the client never *decides* who is logged in — it only reflects
what the server says (the checklist's "frontend validation is UX only",
applied to auth). Rendering nothing during the check avoids flashing a
protected page before a redirect. UI role checks (interviewer sees
"Schedule") are presentation only; the server enforces the real rules —
hiding a button is not security and isn't treated as such.

## D4.4 — Tailwind v4 design tokens over a component library

**Alternatives:** MUI/Ant (fast but template-looking, heavy bundles);
shadcn/ui (good, but adds a dependency layer this scope doesn't need).
**Decision:** Tailwind v4 `@theme` tokens (ink neutrals + one indigo
accent + semantic ok/warn/bad) plus ~8 tiny primitives in
`components/ui.jsx` (Button, Input, Field, Badge, Modal…).
**Why:** the app has ~6 screens — a full library is more code than the
app. Design tokens give consistency (every color/shadow has one source of
truth) and I understand every line of the design system because I built it.
Bundle: 264 kB / 90 kB gzip including GSAP and router.

## D4.5 — GSAP only where motion earns its place

**Decision:** GSAP (via `@gsap/react`) animates the landing hero/cards
entrance; the app screens use CSS transitions only. Users with
`prefers-reduced-motion` get everything instantly, no animation.
**Why:** the landing page is a first impression — staggered entrance
sells polish. Dashboards are used repeatedly — entrance animation there
becomes friction on the tenth visit. Accessibility rule from the
checklist applied to motion.

## D4.6 — Accessible-by-default interactive patterns

**Decision:** semantic HTML (`article`, `label`-wrapped fields, real
buttons), `aria-pressed` on toggle groups (role picker, verdict, stars),
`role="alert"` on error notes, `role="dialog" aria-modal` + Escape +
click-outside + scroll-lock on modals, visible `:focus-visible` rings.
**Why:** costs minutes now, unpayable to retrofit later; also directly
verifiable in the browser accessibility tree (which is how the E2E pass
inspected the UI).

## D4.7 — Room lobby in M4, media in M5

**Decision:** `/room/:roomCode` ships in M4 as a lobby: it calls the M2
room endpoint, renders participants/schedule for authorized users, and
maps 404→"no access", 410→"cancelled". No fake video tiles.
**Why:** it proves the whole authorization chain through the real UI
(login → dashboard → join → server check) and gives M5 a clean seam to
mount WebRTC into. The alternative — mock video UI — would violate the
"no placeholder logic" rule; a lobby is honest, working scope.

## D4.8 — Browser E2E as the M4 verification

**Decision:** verified in a real browser: register (interviewer) →
schedule (modal, future-date input) → join room (lobby renders) →
candidate login → sees interview, joins → interviewer submits feedback
(4★ pass + private note) → interview moves to "Past & completed" →
**candidate's API response contains `{"result":"pass"}` only** — the
private comments never leave the server. Outsider/anonymous probes of the
room URL: 404/401. Test data deleted from Atlas afterwards.
**Why:** M2/M3 proved the API contracts; M4's risk is the seams between
UI state, cookies, and redirects — only a real browser exercises those.
One UI bug was found and fixed this way (candidates were offered a
Cancel button the server would reject — now interviewer-only).
