// Integration tests for the Interview API (M2).
// Run:  node tests/m2-interviews.test.mjs   (server must be running on PORT)
// Creates its own throwaway users, verifies every rule, then cleans up.
import "dotenv/config";
import mongoose from "mongoose";

const BASE = `http://localhost:${process.env.PORT || 5000}/api`;
const RUN = `m2test-${process.pid}`;
let passed = 0;
let failed = 0;

function check(name, cond, detail = "") {
  if (cond) {
    passed++;
    console.log(`  ok   ${name}`);
  } else {
    failed++;
    console.error(`  FAIL ${name} ${detail}`);
  }
}

// Minimal per-user cookie jar so we can act as 3 different people
function makeClient() {
  const jar = {};
  return async function call(path, { method = "GET", body } = {}) {
    const res = await fetch(BASE + path, {
      method,
      headers: {
        "content-type": "application/json",
        cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; "),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    (res.headers.getSetCookie?.() ?? []).forEach((c) => {
      const [kv] = c.split(";");
      const i = kv.indexOf("=");
      jar[kv.slice(0, i)] = kv.slice(i + 1);
    });
    let json = null;
    try { json = await res.json(); } catch { /* no body */ }
    return { status: res.status, body: json };
  };
}

const interviewer = makeClient();
const candidate = makeClient();
const outsider = makeClient(); // registered user who is NOT a participant

console.log("— setup: three users");
await interviewer("/auth/register", { method: "POST", body: { name: "IV", email: `${RUN}-iv@t.dev`, password: "StrongPass123", role: "interviewer" } });
await candidate("/auth/register", { method: "POST", body: { name: "CD", email: `${RUN}-cd@t.dev`, password: "StrongPass123", role: "candidate" } });
await outsider("/auth/register", { method: "POST", body: { name: "OUT", email: `${RUN}-out@t.dev`, password: "StrongPass123", role: "interviewer" } });

console.log("— scheduling rules");
let r = await candidate("/interviews", { method: "POST", body: { title: "X", candidateEmail: `${RUN}-cd@t.dev`, scheduledAt: new Date(Date.now() + 3600e3) } });
check("candidate cannot schedule (403)", r.status === 403, `got ${r.status}`);

r = await interviewer("/interviews", { method: "POST", body: { title: "", candidateEmail: `${RUN}-cd@t.dev`, scheduledAt: new Date(Date.now() + 3600e3) } });
check("empty title rejected (400)", r.status === 400);

r = await interviewer("/interviews", { method: "POST", body: { title: "X", candidateEmail: "ghost@t.dev", scheduledAt: new Date(Date.now() + 3600e3) } });
check("unknown candidate rejected (404)", r.status === 404);

r = await interviewer("/interviews", { method: "POST", body: { title: "X", candidateEmail: `${RUN}-out@t.dev`, scheduledAt: new Date(Date.now() + 3600e3) } });
check("interviewer-role email not schedulable as candidate (404)", r.status === 404);

r = await interviewer("/interviews", { method: "POST", body: { title: "X", candidateEmail: `${RUN}-cd@t.dev`, scheduledAt: new Date(Date.now() - 3600e3) } });
check("past time rejected (400)", r.status === 400);

r = await interviewer("/interviews", { method: "POST", body: { title: "Node.js Round 1", description: "Core + security", candidateEmail: `${RUN}-cd@t.dev`, scheduledAt: new Date(Date.now() + 3600e3) } });
check("valid schedule created (201)", r.status === 201, JSON.stringify(r.body));
const iv = r.body?.interview;
check("room code is 32-hex", /^[a-f0-9]{32}$/.test(iv?.roomCode ?? ""));
check("participants populated without secrets", iv?.candidate?.name === "CD" && iv?.candidate?.password === undefined && iv?.candidate?.tokenVersion === undefined);

console.log("— list scoping & pagination");
r = await interviewer("/interviews");
check("interviewer sees own interview", r.body?.total === 1 && r.body?.interviews?.length === 1);
r = await candidate("/interviews?page=1&limit=5");
check("candidate sees the same interview", r.body?.total === 1);
r = await outsider("/interviews");
check("outsider sees nothing (scoped)", r.body?.total === 0, JSON.stringify(r.body));
r = await interviewer("/interviews?status=weird");
check("bad status filter rejected (400)", r.status === 400);

console.log("— room lookup authorization");
r = await candidate(`/interviews/room/${iv.roomCode}`);
check("participant can open room (200)", r.status === 200);
r = await outsider(`/interviews/room/${iv.roomCode}`);
check("outsider gets 404 (indistinguishable from missing)", r.status === 404);
r = await candidate(`/interviews/room/not-a-code`);
check("malformed room code rejected (400)", r.status === 400);
r = await fetch(`${BASE}/interviews/room/${iv.roomCode}`);
check("anonymous gets 401", r.status === 401);

console.log("— feedback rules & privacy");
r = await candidate(`/interviews/${iv._id}/feedback`, { method: "PATCH", body: { rating: 5, result: "pass" } });
check("candidate cannot submit feedback (403)", r.status === 403);
r = await outsider(`/interviews/${iv._id}/feedback`, { method: "PATCH", body: { rating: 5, result: "pass" } });
check("non-owning interviewer cannot (404, no IDOR probe)", r.status === 404);
r = await interviewer(`/interviews/${iv._id}/feedback`, { method: "PATCH", body: { rating: 9, result: "pass" } });
check("rating out of range rejected (400)", r.status === 400);
r = await interviewer(`/interviews/${iv._id}/feedback`, { method: "PATCH", body: { rating: 4, comments: "Solid fundamentals", result: "pass" } });
check("owning interviewer submits feedback (200)", r.status === 200);
check("status flips to completed", r.body?.interview?.status === "completed");

r = await candidate("/interviews");
const seen = r.body?.interviews?.[0];
check("candidate sees result", seen?.feedback?.result === "pass");
check("candidate NEVER sees comments/rating", seen?.feedback?.comments === undefined && seen?.feedback?.rating === undefined, JSON.stringify(seen?.feedback));
r = await interviewer("/interviews");
check("interviewer still sees full feedback", r.body?.interviews?.[0]?.feedback?.comments === "Solid fundamentals");

console.log("— cancel rules");
r = await interviewer(`/interviews/${iv._id}/cancel`, { method: "PATCH" });
check("cannot cancel a completed interview (409)", r.status === 409);
r = await interviewer("/interviews", { method: "POST", body: { title: "Round 2", candidateEmail: `${RUN}-cd@t.dev`, scheduledAt: new Date(Date.now() + 7200e3) } });
const iv2 = r.body?.interview;
r = await interviewer(`/interviews/${iv2._id}/cancel`, { method: "PATCH" });
check("scheduled interview cancels (200)", r.status === 200 && r.body?.interview?.status === "cancelled");
r = await candidate(`/interviews/room/${iv2.roomCode}`);
check("cancelled room returns 410", r.status === 410);

console.log("— teardown");
await mongoose.connect(process.env.MONGO_URI);
const u = await mongoose.connection.db.collection("users").deleteMany({ email: { $regex: `^${RUN}-` } });
const ivDel = await mongoose.connection.db.collection("interviews").deleteMany({ title: { $in: ["Node.js Round 1", "Round 2", "X"] } });
console.log(`  removed ${u.deletedCount} users, ${ivDel.deletedCount} interviews`);
await mongoose.disconnect();

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
