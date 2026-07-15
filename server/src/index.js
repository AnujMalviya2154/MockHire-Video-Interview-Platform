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

await connectDB();

// Socket.IO shares the HTTP server — same port, same cookie context,
// so the websocket handshake authenticates with the same JWT as REST.
const server = http.createServer(app);
attachSocket(server);

server.listen(PORT, () => {
  console.log(`API + signaling listening on http://localhost:${PORT}`);
});
