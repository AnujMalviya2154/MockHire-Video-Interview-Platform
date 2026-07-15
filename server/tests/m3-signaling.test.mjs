// Integration tests for the signaling layer (M3).
// Run:  node tests/m3-signaling.test.mjs   (server must be running on PORT)
// Exercises handshake auth, room authorization, relay scoping, input
// bounds, and state resync — with real sockets against the live server.
import "dotenv/config";
import mongoose from "mongoose";
import { io as ioc } from "socket.io-client";

const PORT = process.env.PORT || 5000;
const BASE = `http://localhost:${PORT}`;
const RUN = `m3test-${process.pid}`;
let passed = 0;
let failed = 0;

function check(name, cond, detail = "") {
  if (cond) { passed++; console.log(`  ok   ${name}`); }
  else { failed++; console.error(`  FAIL ${name} ${detail}`); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// REST helper with a cookie jar (to register users and grab auth cookies)
function makeClient() {
  const jar = {};
  const call = async (path, { method = "GET", body } = {}) => {
    const res = await fetch(`${BASE}/api${path}`, {
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
    try { json = await res.json(); } catch { /* empty */ }
    return { status: res.status, body: json };
  };
  call.cookieHeader = () =>
    Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");
  return call;
}

// Socket helper: connect with (or without) a cookie header
function connect(cookie) {
  return ioc(BASE, {
    transports: ["websocket"],
    extraHeaders: cookie ? { cookie } : {},
    reconnection: false,
    timeout: 5000,
  });
}
function joinRoom(socket, roomCode) {
  return new Promise((resolve) => socket.emit("join-room", roomCode, resolve));
}
function once(socket, event, ms = 3000) {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(undefined), ms);
    socket.once(event, (data) => { clearTimeout(t); resolve(data); });
  });
}

console.log("— setup: users + one scheduled interview (via REST)");
const interviewer = makeClient();
const candidate = makeClient();
const outsider = makeClient();
await interviewer("/auth/register", { method: "POST", body: { name: "IV", email: `${RUN}-iv@t.dev`, password: "StrongPass123", role: "interviewer" } });
await candidate("/auth/register", { method: "POST", body: { name: "CD", email: `${RUN}-cd@t.dev`, password: "StrongPass123", role: "candidate" } });
await outsider("/auth/register", { method: "POST", body: { name: "OUT", email: `${RUN}-out@t.dev`, password: "StrongPass123", role: "candidate" } });
let r = await interviewer("/interviews", { method: "POST", body: { title: "M3 Signal Test", candidateEmail: `${RUN}-cd@t.dev`, scheduledAt: new Date(Date.now() + 3600e3) } });
const ROOM = r.body?.interview?.roomCode;
check("setup interview created", typeof ROOM === "string", JSON.stringify(r.body));

console.log("— handshake authentication");
const anon = connect(null);
const anonErr = await new Promise((res) => {
  anon.on("connect_error", (e) => res(e.message));
  anon.on("connect", () => res("connected"));
});
check("anonymous socket rejected at handshake", anonErr === "unauthorized", anonErr);
anon.close();

const sIv = connect(interviewer.cookieHeader());
await new Promise((res) => sIv.on("connect", res));
check("authenticated socket connects", sIv.connected);

console.log("— room authorization");
let ack = await joinRoom(sIv, "zzzz");
check("malformed room code rejected", ack?.error === "Invalid room code");
ack = await joinRoom(sIv, "a".repeat(32));
check("nonexistent room rejected as not-found", ack?.error === "Interview not found");

const sOut = connect(outsider.cookieHeader());
await new Promise((res) => sOut.on("connect", res));
ack = await joinRoom(sOut, ROOM);
check("authenticated non-participant rejected (same not-found)", ack?.error === "Interview not found");
sOut.close();

ack = await joinRoom(sIv, ROOM);
check("interviewer joins own room", ack?.ok === true, JSON.stringify(ack));

const sCd = connect(candidate.cookieHeader());
await new Promise((res) => sCd.on("connect", res));
const peerJoinedAtIv = once(sIv, "peer-joined");
ack = await joinRoom(sCd, ROOM);
check("candidate joins same room", ack?.ok === true);
const pj = await peerJoinedAtIv;
check("interviewer notified peer-joined with identity", pj?.name === "CD" && pj?.role === "candidate");

console.log("— signaling relay");
const sigAtCd = once(sCd, "signal");
sIv.emit("signal", { type: "offer", sdp: "FAKE_SDP_OFFER" });
const sig = await sigAtCd;
check("offer relayed to peer", sig?.sdp === "FAKE_SDP_OFFER");
const sigAtIv = once(sIv, "signal");
sCd.emit("signal", { type: "answer", sdp: "FAKE_SDP_ANSWER" });
check("answer relayed back", (await sigAtIv)?.sdp === "FAKE_SDP_ANSWER");

console.log("— chat");
const chatAtIv = once(sIv, "chat-message");
sCd.emit("chat-message", "  hello <b>world</b>  ");
const msg = await chatAtIv;
check("chat relayed with sender identity", msg?.from?.name === "CD");
check("chat trimmed, HTML passed as inert text", msg?.text === "hello <b>world</b>");
const longAtIv = once(sIv, "chat-message", 1500);
sCd.emit("chat-message", "x".repeat(5000));
const longMsg = await longAtIv;
check("oversized chat truncated to 1000", longMsg?.text?.length === 1000);

console.log("— code pad sync + resync");
const codeAtIv = once(sIv, "code-change");
sCd.emit("code-change", "console.log('hi')");
check("code change relayed", (await codeAtIv) === "console.log('hi')");
const langAtIv = once(sIv, "code-language");
sCd.emit("code-language", "python");
check("language change relayed", (await langAtIv) === "python");
const badLangAtIv = once(sIv, "code-language", 1200);
sCd.emit("code-language", "brainfuck");
check("disallowed language dropped", (await badLangAtIv) === undefined);

// candidate refreshes: disconnect + reconnect + rejoin → resynced state
sCd.close();
await sleep(300);
const sCd2 = connect(candidate.cookieHeader());
await new Promise((res) => sCd2.on("connect", res));
ack = await joinRoom(sCd2, ROOM);
check("rejoin after refresh resyncs pad", ack?.ok === true && ack?.code === "console.log('hi')" && ack?.language === "python", JSON.stringify(ack));

console.log("— room capacity & event guards");
const sOut2 = connect(outsider.cookieHeader());
await new Promise((res) => sOut2.on("connect", res));
// outsider still can't join; and even if the room were open, a third
// distinct user must be rejected — proven via the not-found gate first.
ack = await joinRoom(sOut2, ROOM);
check("third user still rejected", ack?.error === "Interview not found");
// events from a socket that never joined a room must not relay
const strayAtIv = once(sIv, "chat-message", 1200);
sOut2.emit("chat-message", "injected");
check("chat from room-less socket dropped", (await strayAtIv) === undefined);
sOut2.close();

console.log("— cancelled interview closes the door");
r = await interviewer(`/interviews/${r.body.interview._id}/cancel`, { method: "PATCH" });
check("interview cancelled via REST", r.status === 200);
const sCd3 = connect(candidate.cookieHeader());
await new Promise((res) => sCd3.on("connect", res));
ack = await joinRoom(sCd3, ROOM);
check("join rejected after cancellation", ack?.error === "This interview was cancelled");
sCd3.close();

sIv.close();
sCd2.close();

console.log("— teardown");
await mongoose.connect(process.env.MONGO_URI);
const u = await mongoose.connection.db.collection("users").deleteMany({ email: { $regex: `^${RUN}-` } });
const ivDel = await mongoose.connection.db.collection("interviews").deleteMany({ title: "M3 Signal Test" });
console.log(`  removed ${u.deletedCount} users, ${ivDel.deletedCount} interviews`);
await mongoose.disconnect();

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
