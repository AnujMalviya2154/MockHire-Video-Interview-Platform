# Decision Record — M0: PRD & Project Scaffold

Every milestone has one of these documents. Format: the decision, the
alternatives that were on the table, and why this one won. Read these
top-to-bottom and you can defend every choice in the codebase.

---

## D0.1 — Write a PRD before any code

**Alternatives:** jump straight into coding; follow the tutorial video step-by-step.
**Decision:** write a full PRD with functional requirements, security requirements, and acceptance criteria first.
**Why:** a defined scope prevents feature creep (v1 explicitly excludes recording, group calls, code execution), gives measurable "done" criteria, and forces security to be designed in rather than patched on. In interviews, "I wrote requirements before code" separates you from every other tutorial-follower.

## D0.2 — Native WebRTC + Socket.IO instead of a video SDK (ZegoCloud / Stream / 100ms)

**Alternatives:** ZegoCloud prebuilt UI kit (most tutorials use this), Stream Video SDK, Agora.
**Decision:** browser-native WebRTC for media, self-hosted Socket.IO for signaling.
**Why:**
- No third-party account, API keys, quotas, or vendor lock-in — the project runs forever, free, anywhere.
- Every layer is explainable: offer/answer, ICE, STUN — you own the whole stack instead of calling a black-box SDK.
- Media flows **peer-to-peer**: video never touches our server, which is both a privacy win and a bandwidth win.
**Trade-off accepted:** without a TURN relay server, calls across very strict NATs/corporate firewalls may fail. Fine for a demo/portfolio project; TURN is a documented v2 item.

## D0.3 — MERN stack

**Alternatives:** Next.js full-stack, Spring Boot + React, Django + React.
**Decision:** MongoDB + Express + React + Node.
**Why:** matches the resume claim being backed by this project, matches existing certification (Ethnus MERN) and the two other portfolio projects, and a JS-everywhere stack keeps one language across client, server, and signaling. Socket.IO's natural home is Node.

## D0.4 — Monorepo (`client/` + `server/` in one repo)

**Alternatives:** two separate repos.
**Decision:** single repo, two packages.
**Why:** one clone, one issue tracker, atomic commits that touch both sides (e.g. an API change plus its consumer), and simpler to present. Standard for portfolio-scale full-stack apps.

## D0.5 — Vite over Create React App

**Decision:** Vite for the client build.
**Why:** CRA is deprecated/unmaintained; Vite is the current community standard — instant dev server, fast HMR, smaller production bundles.

## D0.6 — Milestone-per-commit git strategy

**Decision:** each milestone (M0–M7) ends in exactly one meaningful, conventional-format commit.
**Why:** the git history reads as a deliberate engineering log — reviewable, revertable stages instead of one giant "initial commit" dump or hundreds of "fix" commits.

## D0.7 — Secrets policy from day zero

**Decision:** `.gitignore` excludes `.env` from the very first commit; `.env.example` documents required variables with placeholders.
**Why:** the most common real-world security failure in student projects is a committed secret. Excluding it *before* any secret exists means it can never leak into git history (history is forever, even after deletion).
