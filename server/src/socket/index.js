import { Server } from "socket.io";
import { verifyTokenFromCookieHeader } from "../middleware/auth.js";
import Interview from "../models/Interview.js";

// ── In-call constraints ─────────────────────────────────────────────
const MAX_CHAT_LENGTH = 1000;
const MAX_CODE_LENGTH = 50_000; // ~50 kb of code — plenty for an interview pad
const ALLOWED_LANGUAGES = ["javascript", "python", "java", "cpp", "plaintext"];
// Per-socket event budget: enough for fast typing in the code pad,
// far below flooding rates.
const EVENTS_PER_SEC = 30;

// Last code-pad state per room, so a peer who refreshes gets the
// current contents back. In-memory: acceptable for 1:1 rooms — state
// is ephemeral by design (see decision D3.6).
const roomState = new Map(); // roomCode -> { code, language, participants: Set<userId> }

function getRoomState(roomCode) {
  let s = roomState.get(roomCode);
  if (!s) {
    s = { 
      code: "", 
      language: "javascript", 
      participants: new Set(),
      participantModes: new Map(),
    };
    roomState.set(roomCode, s);
  }
  return s;
}

export function getRoomConnectionMode(roomCode) {
  const state = roomState.get(roomCode);
  if (!state || state.participants.size === 0) return "unknown";
  
  if (state.participantModes.size === 0) return "unknown";

  let hasDirect = false;
  let hasRelay = false;
  let hasUnknown = state.participantModes.size < state.participants.size;

  for (const p of state.participantModes.values()) {
    if (p.mode === "relay") hasRelay = true;
    else if (p.mode === "direct") hasDirect = true;
    else hasUnknown = true;
  }

  if (hasRelay) return "relay";
  if (hasDirect && !hasUnknown) return "direct";
  if (hasDirect && hasUnknown) return "relay"; // Conservative policy
  return "unknown";
}

/** Read-only snapshot of active room codes with at least one participant. */
export function getActiveRoomCodes() {
  const codes = [];
  for (const [code, state] of roomState) {
    if (state.participants.size > 0) codes.push(code);
  }
  return codes;
}

export function attachSocket(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: process.env.CLIENT_ORIGIN || "http://localhost:5173",
      credentials: true, // the auth cookie rides the handshake
    },
    maxHttpBufferSize: 100_000, // hard cap on any single packet (~100 kb)
  });

  // ── Handshake authentication ──────────────────────────────────────
  // Same JWT/cookie validation path as REST (verifyTokenFromCookieHeader
  // wraps the identical checks incl. tokenVersion revocation). An
  // unauthenticated socket never gets past the handshake.
  io.use(async (socket, next) => {
    const user = await verifyTokenFromCookieHeader(socket.request.headers.cookie);
    if (!user) return next(new Error("unauthorized"));
    socket.user = { id: user._id.toString(), name: user.name, role: user.role };
    next();
  });

  io.on("connection", (socket) => {
    // Naive token-bucket rate limit for everything this socket emits
    let budget = EVENTS_PER_SEC;
    const refill = setInterval(() => (budget = EVENTS_PER_SEC), 1000);
    socket.use((_, next) => {
      if (--budget < 0) return next(new Error("rate_limited"));
      next();
    });

    let joinedRoom = null; // one room per socket — set only after authorization

    // ── join-room: the authorization gate ───────────────────────────
    socket.on("join-room", async (roomCode, ack) => {
      try {
        if (joinedRoom) return ack?.({ error: "Already in a room" });
        if (typeof roomCode !== "string" || !/^[a-f0-9]{32}$/.test(roomCode))
          return ack?.({ error: "Invalid room code" });

        // Authorization against the DB record — identical rule to the
        // REST /interviews/room/:roomCode endpoint (M2): participants
        // only; cancelled rooms are closed.
        const interview = await Interview.findOne({ roomCode });
        const isParticipant =
          interview &&
          [interview.interviewer, interview.candidate].some(
            (id) => id.toString() === socket.user.id
          );
        if (!isParticipant) return ack?.({ error: "Interview not found" });
        if (interview.status === "cancelled")
          return ack?.({ error: "This interview was cancelled" });

        const EIGHT_HOURS = 8 * 60 * 60 * 1000;
        if (Date.now() > new Date(interview.scheduledAt).getTime() + EIGHT_HOURS) {
          return ack?.({ error: "This interview room expired 8 hours after the scheduled time." });
        }

        const state = getRoomState(roomCode);
        // 1:1 rooms — same user may reconnect (refresh), a third user may not
        if (state.participants.size >= 2 && !state.participants.has(socket.user.id))
          return ack?.({ error: "Room is full" });

        await socket.join(roomCode);
        joinedRoom = roomCode;
        state.participants.add(socket.user.id);

        // Tell the peer someone arrived; give the joiner current pad state
        socket.to(roomCode).emit("peer-joined", {
          id: socket.user.id,
          name: socket.user.name,
          role: socket.user.role,
        });
        ack?.({
          ok: true,
          code: state.code,
          language: state.language,
          self: socket.user,
        });
      } catch (err) {
        console.error("join-room failed:", err.message);
        ack?.({ error: "Could not join room" });
      }
    });

    // Every in-room event goes through this guard: no room, no relay.
    function inRoom(handler) {
      return (...args) => {
        if (!joinedRoom) return;
        handler(...args);
      };
    }

    // ── WebRTC signaling relay ──────────────────────────────────────
    // The server never inspects SDP/ICE payloads — it only forwards them
    // to the *other* participant of the authorized room. Size is bounded
    // by maxHttpBufferSize.
    socket.on(
      "signal",
      inRoom((payload) => {
        if (payload == null || typeof payload !== "object") return;
        socket.to(joinedRoom).emit("signal", payload);
      })
    );

    // ── Chat relay ──────────────────────────────────────────────────
    // Relay-only (not persisted — D3.6). Text is length-capped here and
    // rendered as text by React on the client: no HTML ever interpreted.
    socket.on(
      "chat-message",
      inRoom((text) => {
        if (typeof text !== "string") return;
        const clean = text.trim().slice(0, MAX_CHAT_LENGTH);
        if (!clean) return;
        io.to(joinedRoom).emit("chat-message", {
          from: { id: socket.user.id, name: socket.user.name },
          text: clean,
          at: Date.now(),
        });
      })
    );

    // ── Code pad sync ───────────────────────────────────────────────
    socket.on(
      "code-change",
      inRoom((code) => {
        if (typeof code !== "string" || code.length > MAX_CODE_LENGTH) return;
        getRoomState(joinedRoom).code = code;
        socket.to(joinedRoom).emit("code-change", code);
      })
    );

    socket.on(
      "code-language",
      inRoom((language) => {
        if (!ALLOWED_LANGUAGES.includes(language)) return;
        getRoomState(joinedRoom).language = language;
        socket.to(joinedRoom).emit("code-language", language);
      })
    );

    // ── Telemetry relay-state ───────────────────────────────────────
    socket.on(
      "connection-mode",
      inRoom((payload) => {
        if (!payload || typeof payload !== "object") return;
        const { mode, sessionGeneration, sequence } = payload;
        
        if (!["direct", "relay"].includes(mode)) return;
        if (typeof sessionGeneration !== "number" || typeof sequence !== "number") return;

        const state = getRoomState(joinedRoom);
        const current = state.participantModes.get(socket.user.id);

        if (current) {
          if (sessionGeneration < current.sessionGeneration) return;
          if (sessionGeneration === current.sessionGeneration && sequence <= current.sequence) return;
        }

        state.participantModes.set(socket.user.id, {
          mode,
          sessionGeneration,
          sequence,
        });
      })
    );

    // ── Teardown ────────────────────────────────────────────────────
    socket.on("disconnect", () => {
      clearInterval(refill);
      if (!joinedRoom) return;
      const state = roomState.get(joinedRoom);
      
      if (state) {
        // Only drop the participant and emit peer-left if they have no other 
        // live socket in the room (e.g. they completely left, didn't just refresh).
        const stillHere = [...io.sockets.adapter.rooms.get(joinedRoom) ?? []].some(
          (sid) => io.sockets.sockets.get(sid)?.user?.id === socket.user.id
        );
        
        if (!stillHere) {
          state.participants.delete(socket.user.id);
          state.participantModes.delete(socket.user.id);
          socket.to(joinedRoom).emit("peer-left", { id: socket.user.id });
        }
        
        // Last one out: drop the room's ephemeral state entirely
        if (!(io.sockets.adapter.rooms.get(joinedRoom)?.size > 0)) {
          roomState.delete(joinedRoom);
        }
      }
    });
  });

  return io;
}
