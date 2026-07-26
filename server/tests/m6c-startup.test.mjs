// Startup contract for the API process (M6c).
// Run:  node tests/m6c-startup.test.mjs      (must be run with port 5487 free)
//
// Regression test for the dev-time bug where `npm run dev` left port 5000
// refusing connections for ~6.5s while Mongoose dialled Atlas, so every
// client boot logged in the Vite terminal:
//     http proxy error: /api/auth/me
//     AggregateError [ECONNREFUSED]
//
// The contract asserted here is about *bind latency*: the HTTP listener must
// be accepting connections long before any database round-trip could finish.
// It deliberately does NOT assert anything about Mongo — a test that needed a
// live Atlas connection would be measuring the network, not our startup order.
import "dotenv/config";
import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 5487; // dedicated port so a running dev server can't skew results
const BIND_BUDGET_MS = 1500; // process spawn + module load, with no DB wait
let passed = 0;
let failed = 0;

function check(name, cond, detail = "") {
  if (cond) { passed++; console.log(`  ok   ${name}`); }
  else { failed++; console.error(`  FAIL ${name} ${detail}`); }
}

// A bare TCP connect: "is anything accepting on this port yet?"
// Deliberately lower-level than fetch() — we are testing the listener, not a route.
function canConnect(port) {
  return new Promise((resolve) => {
    const sock = net.connect({ host: "127.0.0.1", port });
    const done = (ok) => { sock.destroy(); resolve(ok); };
    sock.once("connect", () => done(true));
    sock.once("error", () => done(false));
    sock.setTimeout(400, () => done(false));
  });
}

console.log("— API binds its port without waiting for the database");

// An unreachable-but-valid Mongo URI makes the point sharply: even when the
// database takes many seconds (or never answers), the port must come up.
// serverSelectionTimeoutMS in db.js bounds how long that failure takes.
const child = spawn(process.execPath, ["src/index.js"], {
  cwd: SERVER_DIR,
  env: {
    ...process.env,
    PORT: String(PORT),
    NODE_ENV: "test",
    // 203.0.113.0/24 is TEST-NET-3 (RFC 5737): guaranteed unroutable, so this
    // stands in for "Atlas is slow / unreachable" without touching the network.
    MONGO_URI: "mongodb://203.0.113.1:27017/mockhire-startup-test",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let log = "";
child.stdout.on("data", (b) => (log += b));
child.stderr.on("data", (b) => (log += b));

const started = Date.now();
let boundAfter = null;
while (Date.now() - started < 12_000) {
  if (await canConnect(PORT)) { boundAfter = Date.now() - started; break; }
  if (child.exitCode !== null) break; // died before ever binding
  await new Promise((r) => setTimeout(r, 25));
}

check(
  "port accepts connections",
  boundAfter !== null,
  boundAfter === null ? `\n       never bound (exit ${child.exitCode}). Log:\n${log}` : ""
);
check(
  `binds in under ${BIND_BUDGET_MS}ms`,
  boundAfter !== null && boundAfter < BIND_BUDGET_MS,
  boundAfter === null ? "" : `— took ${boundAfter}ms; the listener is blocked on a startup dependency`
);
// The listener must also survive the database failing: a dev server that dies
// when Atlas hiccups sends the client straight back to ECONNREFUSED.
check(
  "process stays alive while the database is unreachable",
  child.exitCode === null,
  child.exitCode === null ? "" : `— exited with code ${child.exitCode}. Log:\n${log}`
);

child.kill("SIGKILL");

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
