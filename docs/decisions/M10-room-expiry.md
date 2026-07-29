# M10: Room Expiry Lifecycle

## Context & Problem
Currently, per decision D6.4, completed interviews remain permanently open so that participants can return for debriefs or follow-up conversations. 

However, this leads to two unintended side effects:
1. **UI Clutter:** The dashboard theoretically shouldn't show "Join" buttons for interviews that happened months ago (though an oversight in `Dashboard.jsx` currently hides *all* past join buttons anyway).
2. **Lifecycle Ambiguity:** A room staying open forever violates the principle of least privilege over time. It leaves socket endpoints open to connection attempts indefinitely, long after the business utility of the room has ended.

## Decision
We will introduce an **8-hour expiry window** for all interview rooms. 
An interview room is considered "expired" when the current time is exactly 8 hours past its `scheduledAt` timestamp.

### 1. UI Enforcement (`client/src/pages/Dashboard.jsx`)
- The "Join" button for past/completed interviews will render normally, *unless* the interview is expired.
- Calculation: `const isExpired = Date.now() > new Date(iv.scheduledAt).getTime() + 8 * 60 * 60 * 1000;`

### 2. Backend Enforcement (`server/src/routes/interviews.js` & `server/src/socket/index.js`)
- **REST API:** `GET /interviews/room/:roomCode` will check the 8-hour rule. If expired, it will return a `403 Forbidden` (or `410 Gone`) with a payload indicating: *"This interview room expired 8 hours after the scheduled time."*
- **Socket:** `socket.on("join-room")` will enforce the identical 8-hour rule and reject the handshake if expired.

### 3. Graceful Mid-Call Handling
If two participants are actively in the room when the 8-hour mark is reached, they **will not be kicked out**. The WebRTC media is strictly peer-to-peer and unaffected by server polling. 
The backend enforcement applies strictly to *new connections* (or reconnections). If a user refreshes their page at hour 8.01, they will be blocked from re-entering.

## Consequences
- **Positive:** Closes the loop on room lifecycles without disrupting immediate post-interview debriefs. Keeps the dashboard UI clean.
- **Negative:** If participants want to meet 9 hours later, they must schedule a new interview via the UI.
