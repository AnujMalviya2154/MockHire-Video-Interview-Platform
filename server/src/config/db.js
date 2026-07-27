import mongoose from "mongoose";

// Connecting is deliberately decoupled from the HTTP listener (see index.js):
// the API binds its port first and this runs in the background. A slow or
// briefly unreachable database therefore delays *database-backed* responses
// instead of refusing TCP connections outright — which is what used to make
// the dev client log `ECONNREFUSED` on every boot.
//
// A missing MONGO_URI is a configuration error no amount of retrying fixes, so
// that still exits. An unreachable server is transient, so that retries with
// backoff and lets Mongoose's own reconnection logic take over once connected.
const RETRY_BASE_MS = 1000;
const RETRY_MAX_MS = 30_000;

const bootTime = Date.now();

export async function connectDB() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error("MONGO_URI is not set. Copy .env.example to .env and configure it.");
    process.exit(1);
  }

  // Strict query filtering — unknown fields in filters are rejected
  mongoose.set("strictQuery", true);
  // Don't queue queries against a down database: fail fast with a clear error
  // rather than letting requests hang until Mongoose's buffer timeout. The
  // readiness gate in app.js turns that into an honest 503 for callers.
  mongoose.set("bufferCommands", false);

  for (let attempt = 1; ; attempt++) {
    try {
      console.log(`[${new Date().toISOString()}] [sys] [db] [connectDB] CONNECTION_ATTEMPT`, { attempt, elapsedMs: Date.now() - bootTime });
      const conn = await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });
      console.log(`[${new Date().toISOString()}] [sys] [db] [connectDB] CONNECTION_SUCCESS`, { attempt, readyState: mongoose.connection.readyState, elapsedMs: Date.now() - bootTime });
      console.log(`MongoDB connected: ${conn.connection.host}`);
      return;
    } catch (err) {
      console.log(`[${new Date().toISOString()}] [sys] [db] [connectDB] CONNECTION_FAILED`, { attempt, error: err.message });
      // err.message can carry the cluster hostname; that's operational detail,
      // not user data, and it's the single most useful thing for debugging.
      const wait = Math.min(RETRY_BASE_MS * 2 ** (attempt - 1), RETRY_MAX_MS);
      console.error(
        `MongoDB connection failed (attempt ${attempt}): ${err.message}\n` +
          `Retrying in ${Math.round(wait / 1000)}s. The API is up and will answer ` +
          `503 on database-backed routes until this succeeds.`
      );
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

// True once Mongoose is connected and ready to accept queries.
export function isDbReady() {
  return mongoose.connection.readyState === 1;
}

mongoose.connection.on("connected", () => console.log(`[${new Date().toISOString()}] [sys] [db] [event] READY_STATE_CHANGED`, { state: 1, text: 'connected' }));
mongoose.connection.on("disconnected", () => console.log(`[${new Date().toISOString()}] [sys] [db] [event] READY_STATE_CHANGED`, { state: 0, text: 'disconnected' }));
mongoose.connection.on("reconnected", () => console.log(`[${new Date().toISOString()}] [sys] [db] [event] READY_STATE_CHANGED`, { state: 1, text: 'reconnected' }));
