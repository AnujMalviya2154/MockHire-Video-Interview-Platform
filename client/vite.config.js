import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Dev proxy: client and API appear same-origin, so the httpOnly auth
    // cookie flows without any cross-origin complexity. In production the
    // client is served behind the same domain (or CLIENT_ORIGIN CORS).
    proxy: {
      "/api": "http://localhost:5000",
      "/socket.io": { target: "http://localhost:5000", ws: true },
    },
  },
});
