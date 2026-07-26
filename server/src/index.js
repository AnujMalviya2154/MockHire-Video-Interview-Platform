import "dotenv/config";
import http from "http";
import app from "./app.js";
import { connectDB } from "./config/db.js";
import { attachSocket } from "./socket/index.js";

const PORT = process.env.PORT || 5000;

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error("JWT_SECRET missing or too short (min 32 chars). Check your .env.");
  process.exit(1);
}

// Socket.IO shares the HTTP server — same port, same cookie context,
// so the websocket handshake authenticates with the same JWT as REST.
const server = http.createServer(app);
attachSocket(server);

// A busy port would otherwise surface as an unhandled 'error' event and a
// raw stack trace. Catch the common case and exit with a clear, actionable
// message instead — anything else is genuinely unexpected, so re-throw it.
server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      `Port ${PORT} is already in use. Stop the other process holding it, ` +
        `or set PORT in your .env to a free port.`
    );
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, () => {
  console.log(`API + signaling listening on http://localhost:${PORT}`);

  // Bind first, connect second. Mongoose dialling Atlas takes several seconds
  // on a cold start; doing it before listen() meant the port refused every
  // connection until it finished, so the Vite dev proxy logged
  // `ECONNREFUSED /api/auth/me` on each client boot. Connecting after the
  // listener is up costs nothing (no request can be served sooner anyway) and
  // makes the API reachable — and honest, via the 503 readiness gate — from
  // the first millisecond.
  connectDB();
});
