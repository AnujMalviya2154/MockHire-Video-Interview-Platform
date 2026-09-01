import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { io as Client } from "socket.io-client";
import { attachSocket, getRoomConnectionMode } from "../src/socket/index.js";
import { createServer } from "node:http";
import Interview from "../src/models/Interview.js";
import User from "../src/models/User.js";
import jwt from "jsonwebtoken";

let io, server, clientSocketA, clientSocketB;
let port;
let authStub = null;
let interviewStub = null;
const originalFindById = User.findById;

process.env.JWT_SECRET = "test-secret-key-1234";

describe("Stage 4: Relay-State Telemetry & Room Reconciliation", () => {
  beforeEach(async () => {
    server = createServer();
    io = attachSocket(server);
    
    await new Promise((resolve) => {
      server.listen(0, () => {
        port = server.address().port;
        resolve();
      });
    });

    // Mock DB layer
    Interview.findOne = async () => interviewStub;
    User.findById = async (id) => {
      if (id === authStub?._id) return { ...authStub, tokenVersion: 1 };
      return null;
    };
  });

  afterEach(() => {
    io.close();
    clientSocketA?.disconnect();
    clientSocketB?.disconnect();
    User.findById = originalFindById;
  });

  async function createClient(userId, role) {
    authStub = { _id: userId, id: userId, name: "User", role, tokenVersion: 1 };
    
    const token = jwt.sign(
      { sub: userId, ver: 1 },
      process.env.JWT_SECRET,
      { expiresIn: "1d", issuer: "mockhire-api", audience: "mockhire-client" }
    );

    const socket = Client(`http://localhost:${port}`, {
      extraHeaders: {
        cookie: `iv_token=${encodeURIComponent(token)}`
      }
    });
    
    await new Promise((resolve, reject) => {
      socket.on("connect", resolve);
      socket.on("connect_error", reject);
    });
    return socket;
  }

  it("host/host selected pair -> direct", async () => {
    const roomCode = "a".repeat(32);
    interviewStub = { 
      status: "scheduled", 
      interviewer: "userA", 
      candidate: "userB",
      scheduledAt: new Date().toISOString()
    };
    
    clientSocketA = await createClient("userA", "interviewer");
    
    await new Promise(r => clientSocketA.emit("join-room", roomCode, r));
    
    // Emit telemetry
    clientSocketA.emit("connection-mode", { mode: "direct", sessionGeneration: 1, sequence: 1 });
    
    // Wait for event loop to process
    await new Promise(r => setTimeout(r, 50));
    
    assert.strictEqual(getRoomConnectionMode(roomCode), "direct"); // Only A is in the room
  });

  it("direct + unknown -> relay (conservative policy)", async () => {
    const roomCode = "123".padStart(32, "0");
    interviewStub = { status: "scheduled", interviewer: "userA", candidate: "userB", scheduledAt: new Date().toISOString() };
    
    clientSocketA = await createClient("userA", "interviewer");
    clientSocketB = await createClient("userB", "candidate");
    
    await new Promise(r => clientSocketA.emit("join-room", roomCode, r));
    await new Promise(r => clientSocketB.emit("join-room", roomCode, r)); // B joins, but hasn't emitted telemetry

    // Emit telemetry for A only
    clientSocketA.emit("connection-mode", { mode: "direct", sessionGeneration: 1, sequence: 1 });
    
    await new Promise(r => setTimeout(r, 50));
    
    assert.strictEqual(getRoomConnectionMode(roomCode), "relay"); // B is implicitly unknown -> relay
  });

  it("A=direct, B=direct -> direct", async () => {
    const roomCode = "b".repeat(32);
    interviewStub = { status: "scheduled", interviewer: "userA", candidate: "userB", scheduledAt: new Date().toISOString() };
    
    clientSocketA = await createClient("userA", "interviewer");
    clientSocketB = await createClient("userB", "candidate");
    
    await new Promise(r => clientSocketA.emit("join-room", roomCode, r));
    await new Promise(r => clientSocketB.emit("join-room", roomCode, r));

    clientSocketA.emit("connection-mode", { mode: "direct", sessionGeneration: 1, sequence: 1 });
    clientSocketB.emit("connection-mode", { mode: "direct", sessionGeneration: 1, sequence: 1 });
    
    await new Promise(r => setTimeout(r, 50));
    assert.strictEqual(getRoomConnectionMode(roomCode), "direct");
  });

  it("A=direct, B=relay -> relay", async () => {
    const roomCode = "c".repeat(32);
    interviewStub = { status: "scheduled", interviewer: "userA", candidate: "userB", scheduledAt: new Date().toISOString() };
    
    clientSocketA = await createClient("userA", "interviewer");
    clientSocketB = await createClient("userB", "candidate");
    
    await new Promise(r => clientSocketA.emit("join-room", roomCode, r));
    await new Promise(r => clientSocketB.emit("join-room", roomCode, r));

    clientSocketA.emit("connection-mode", { mode: "direct", sessionGeneration: 1, sequence: 1 });
    clientSocketB.emit("connection-mode", { mode: "relay", sessionGeneration: 1, sequence: 1 });
    
    await new Promise(r => setTimeout(r, 50));
    assert.strictEqual(getRoomConnectionMode(roomCode), "relay");
  });

  it("stale direct (lower sequence) cannot overwrite newer relay", async () => {
    const roomCode = "d".repeat(32);
    interviewStub = { status: "scheduled", interviewer: "userA", candidate: "userB", scheduledAt: new Date().toISOString() };
    
    clientSocketA = await createClient("userA", "interviewer");
    clientSocketB = await createClient("userB", "candidate"); // To make B=direct
    
    await new Promise(r => clientSocketA.emit("join-room", roomCode, r));
    await new Promise(r => clientSocketB.emit("join-room", roomCode, r));
    clientSocketB.emit("connection-mode", { mode: "direct", sessionGeneration: 1, sequence: 1 });

    clientSocketA.emit("connection-mode", { mode: "relay", sessionGeneration: 1, sequence: 2 });
    await new Promise(r => setTimeout(r, 20));
    
    // This stale event should be ignored
    clientSocketA.emit("connection-mode", { mode: "direct", sessionGeneration: 1, sequence: 1 });
    await new Promise(r => setTimeout(r, 20));

    assert.strictEqual(getRoomConnectionMode(roomCode), "relay");
  });

  it("old peer-session (lower generation) cannot overwrite new session", async () => {
    const roomCode = "e".repeat(32);
    interviewStub = { status: "scheduled", interviewer: "userA", candidate: "userB", scheduledAt: new Date().toISOString() };
    
    clientSocketA = await createClient("userA", "interviewer");
    clientSocketB = await createClient("userB", "candidate");
    
    await new Promise(r => clientSocketA.emit("join-room", roomCode, r));
    await new Promise(r => clientSocketB.emit("join-room", roomCode, r));
    clientSocketB.emit("connection-mode", { mode: "relay", sessionGeneration: 2, sequence: 1 });

    // Generation 2 direct is received
    clientSocketA.emit("connection-mode", { mode: "direct", sessionGeneration: 2, sequence: 1 });
    await new Promise(r => setTimeout(r, 20));
    
    // Delayed event from Generation 1 relay arrives
    clientSocketA.emit("connection-mode", { mode: "relay", sessionGeneration: 1, sequence: 5 });
    await new Promise(r => setTimeout(r, 20));

    // Because B is relay, wait, B=relay means room is relay. Let's make B direct so we only test A's state.
    clientSocketB.emit("connection-mode", { mode: "direct", sessionGeneration: 2, sequence: 2 });
    await new Promise(r => setTimeout(r, 20));
    
    // Now A is direct (Gen 2), B is direct. Stale Gen 1 relay should have been ignored.
    assert.strictEqual(getRoomConnectionMode(roomCode), "direct");
  });

  it("disconnect cleans participant session state and room-empty cleanup works", async () => {
    const roomCode = "f".repeat(32);
    interviewStub = { status: "scheduled", interviewer: "userA", candidate: "userB", scheduledAt: new Date().toISOString() };
    
    clientSocketA = await createClient("userA", "interviewer");
    await new Promise(r => clientSocketA.emit("join-room", roomCode, r));
    
    clientSocketA.emit("connection-mode", { mode: "relay", sessionGeneration: 1, sequence: 1 });
    await new Promise(r => setTimeout(r, 20));
    
    assert.strictEqual(getRoomConnectionMode(roomCode), "relay");

    clientSocketA.disconnect();
    await new Promise(r => setTimeout(r, 50));
    
    assert.strictEqual(getRoomConnectionMode(roomCode), "unknown");
  });
  
  it("malformed telemetry payloads rejected", async () => {
    const roomCode = "1".repeat(32);
    interviewStub = { status: "scheduled", interviewer: "userA", candidate: "userB", scheduledAt: new Date().toISOString() };
    
    clientSocketA = await createClient("userA", "interviewer");
    await new Promise(r => clientSocketA.emit("join-room", roomCode, r));
    
    // Missing required fields
    clientSocketA.emit("connection-mode", { mode: "direct" });
    // Invalid mode
    clientSocketA.emit("connection-mode", { mode: "invalid", sessionGeneration: 1, sequence: 1 });
    // Non-object
    clientSocketA.emit("connection-mode", "direct");

    await new Promise(r => setTimeout(r, 50));
    // State remains empty/unknown because no valid payload was processed
    assert.strictEqual(getRoomConnectionMode(roomCode), "unknown");
  });
});
