// Socket client for the interview room. One lazy singleton: the socket
// exists only while a room page is mounted — connectSocket() creates it,
// disconnectSocket() tears it down. The httpOnly auth cookie rides the
// handshake automatically (same-origin via the Vite proxy in dev), so
// there is no token handling here at all.
import { io } from "socket.io-client";

let socket = null;

export function connectSocket() {
  if (socket) return socket;
  socket = io("/", {
    withCredentials: true,
    // Fail fast instead of retrying forever against a dead server —
    // the room UI shows an honest "couldn't connect" state instead.
    reconnectionAttempts: 4,
    timeout: 8000,
  });
  return socket;
}

export function disconnectSocket() {
  if (!socket) return;
  socket.removeAllListeners();
  socket.io.removeAllListeners(); // manager-level (reconnect_*) listeners
  socket.disconnect();
  socket = null;
}

// join-room promisified over the server ack. Resolves with
// { code, language, self } or rejects with the server's message.
export function joinRoom(roomCode) {
  return new Promise((resolve, reject) => {
    if (!socket) return reject(new Error("Not connected"));
    const timer = setTimeout(() => reject(new Error("Room join timed out")), 8000);
    socket.emit("join-room", roomCode, (res) => {
      clearTimeout(timer);
      if (res?.ok) resolve(res);
      else reject(new Error(res?.error || "Could not join room"));
    });
  });
}
