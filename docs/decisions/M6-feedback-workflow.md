# M6 — Feedback Workflow & UX Polish

**Commit:** `feat: feedback workflow, status badges, UX polish`

M6 closes the product loop: interview happens (M5) → interviewer records
a verdict → interview becomes `completed` → candidate sees pass/fail on
their dashboard, never the private notes. The API for all of this shipped
in M2; M6 is the client-side workflow that makes people actually use it.
**Zero server changes again** — M2 (27/27) and M3 (22/22) suites re-run
green against the untouched backend.

Changed files: `pages/InterviewRoom.jsx` (ended screen), `pages/Dashboard.jsx`
(feedback states, router-state handoff).

---

## D6.1 — Feedback is prompted at the moment of leaving, not hunted for

**Decision:** When an *interviewer* leaves a call, the ended screen's
primary action is **Write feedback** (secondary: "Later"). It navigates
to the dashboard with `{ state: { feedbackFor: <id> } }` in router
history state; the dashboard opens the feedback modal for that interview
as soon as its list loads, then clears the state (`replace: true`) so a
refresh doesn't re-open it. Candidates get a quiet exit — there is
nothing for them to do.

**Alternatives considered:** (a) feedback form inside the room page —
duplicates the modal, and the room is deliberately ephemeral (M5's
teardown philosophy: leaving destroys everything); (b) a `?feedback=<id>`
query param — survives refresh and copy-paste, so the modal would haunt
the URL; (c) do nothing and rely on the dashboard button — feedback debt
piles up, which is exactly what the dashboard data showed.

**Why:** The moment of highest signal is the moment the call ends —
"your read on the candidate is sharpest right now" is the actual product
reasoning, and the UI says so in those words. Router history state is the
right transport because it's invisible in the URL, dies with the
navigation, and needs no new API surface.

**Interview one-liner:** "Feedback is asked for when the interviewer's
memory is best — a router-state handoff opens the modal exactly once,
with no query param to haunt the URL."

## D6.2 — Feedback debt is visible, not silent

**Decision:** Three additions make un-reviewed sessions impossible to
miss. (1) The dashboard greeting line switches to "N sessions are
waiting on your feedback" whenever past sessions lack a verdict —
displacing the calendar count, because debt outranks schedule. (2) A past
row still in `scheduled` status shows **feedback due** (interviewer) or
**awaiting result** + pending badge (candidate) inline. (3) The
"Give feedback" button on a debt row is promoted from ghost to secondary
so it reads as the row's action, while completed rows demote to a ghost
"Edit feedback".

**Why:** The status enum has no "happened but unreviewed" state — and
shouldn't, since only feedback submission proves the interview happened
(the server can't know a call occurred; media is peer-to-peer by design).
So the client derives that state: *past + still scheduled = a verdict is
owed*. Both roles get honest copy for the same underlying fact, shaped by
what each can do about it — the interviewer can act, the candidate can
only wait, and the pending badge tells them the system hasn't lost them.

**Interview one-liner:** "There's no 'unreviewed' status in the DB
because the server can't see calls happen — the client derives it from
*past + scheduled*, and shows each role what that fact means for them."

## D6.3 — Feedback rows and buttons appear only where they act

**Decision:** The feedback affordance now exists only in the **Past**
section; upcoming rows lost their feedback button. Cancel and Join
appear only on genuinely upcoming rows.

**Why:** M4 wired the feedback button on every non-cancelled row the
interviewer owned — including sessions that hadn't happened yet.
Reviewing a candidate before the interview is nonsense the UI should not
offer (the API would accept it: rating a no-show *is* legitimate, so the
server stays permissive — a deliberate policy gap between what's *valid*
and what's *sensible to offer*). Client offers the sensible; server
enforces the valid.

**Interview one-liner:** "The server accepts feedback any time after
scheduling because rating a no-show is legitimate; the UI only offers it
once the slot is in the past — policy lives client-side, enforcement
server-side."

## D6.4 — Completed rooms stay open; cancelled rooms don't

**Decision:** A completed interview's room remains joinable — the lobby
just notes "Feedback is already in. The room stays open if you two need
it." Cancelled interviews stay hard-blocked (410 → "This interview has
been cancelled." error screen, no lobby).

**Why:** These states differ in *who decided*. Cancellation is an
explicit "this should not happen" — the server refuses both REST lookup
(410) and socket join (M3 test: post-cancellation lockout). Completion is
just "the verdict is recorded"; debriefs and follow-up chats are normal,
and there's no security reason to lock two authorized people out of
their own room. Blocking it would add a server rule solely to remove
product value.

**Interview one-liner:** "Cancelled means someone said don't meet — the
server enforces that. Completed means the paperwork's done — that's no
reason to lock the door between the same two people."

---

## Security review (per SECURITY-CHECKLIST.md)

- **Zero server changes:** the entire milestone is two client files;
  M2 27/27, M3 22/22 re-verified against the running server.
- **Feedback privacy re-proved end-to-end** (the SR-8/M2 property, now
  exercised through the real UI): after submitting rating 4 + private
  comments + pass via the modal, the candidate's `/interviews` payload
  carries `feedback: {"result":"pass"}` only — no `rating`, no
  `comments` keys at all (shaping, not blanking). Candidate dashboard
  renders just the Pass badge.
- **State machine re-proved:** cancel on completed → 409; feedback on
  cancelled → 409; candidate's room fetch of a cancelled interview → 410
  with the error screen.
- **Role gates unchanged:** candidate UI never renders feedback
  affordances (presentation), and the API would 403 regardless
  (enforcement).
- **No new dependencies, no secrets, no `dangerouslySetInnerHTML`;**
  `npm audit` 0 vulnerabilities both packages; production build clean.
- **Router state carries only an interview id** the user already owns —
  no PII in history state.
- **Verified live in the browser, both roles:** interviewer full loop
  (call → leave → prompt → modal pre-filled with interview → submit →
  Pass badge + Edit feedback); candidate view (Pass badge, no comments
  anywhere in the DOM, pending state before verdict, cancelled row);
  completed-room lobby note. Throwaway users/interviews deleted from
  Atlas afterwards.
- **Remaining risks (unchanged from M5):** no TURN; single-process room
  state; both documented.
