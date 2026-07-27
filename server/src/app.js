import path from "path";
import fs from "fs";
import crypto from "crypto";
import { fileURLToPath } from "url";
import express from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import mongoSanitize from "express-mongo-sanitize";
import morgan from "morgan";

import authRoutes from "./routes/auth.js";
import interviewRoutes from "./routes/interviews.js";
import { isDbReady } from "./config/db.js";
import { notFound, errorHandler } from "./middleware/errorHandler.js";

const app = express();
const isProd = process.env.NODE_ENV === "production";

// In production this one Express server also serves the built client —
// same origin as the API, so the SameSite=Lax auth cookie works with zero
// CORS friction (a split static host would silently break cookie auth).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(__dirname, "../../client/dist");
const clientIndexHtml = path.join(clientDist, "index.html");

// CSP allows inline scripts by hash only. The client's index.html carries one
// tiny inline script (pre-paint theme choice), so hash whatever the built HTML
// actually contains at boot — edits to that script can never desync the policy.
let inlineScriptHashes = [];
if (isProd && fs.existsSync(clientIndexHtml)) {
  const html = fs.readFileSync(clientIndexHtml, "utf8");
  inlineScriptHashes = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(
    (m) => `'sha256-${crypto.createHash("sha256").update(m[1]).digest("base64")}'`
  );
}

// Behind a reverse proxy (Render/Railway/nginx) in production: needed so
// rate limiting sees real client IPs and secure cookies work over TLS.
if (process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}
app.disable("x-powered-by");

// ── Security middleware (order matters) ─────────────────────────────
// helmet defaults plus an explicit CSP. The CSP must account for what the
// client actually loads: self-hosted JS/CSS, Google Fonts (stylesheet +
// font files), the hashed inline theme script, and websocket upgrades to
// this same origin. In development the client is served by Vite (which CSP
// here can't govern), so the policy only applies in production.
app.use(
  helmet({
    contentSecurityPolicy: isProd
      ? {
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", ...inlineScriptHashes],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
            imgSrc: ["'self'", "data:"],
            connectSrc: ["'self'", "wss:"],
            mediaSrc: ["'self'", "blob:"], // WebRTC video elements use blob/MediaStream
            objectSrc: ["'none'"],
            frameAncestors: ["'none'"],
            baseUri: ["'self'"],
            formAction: ["'self'"],
          },
        }
      : false,
  })
);

app.use(
  cors({
    origin: process.env.CLIENT_ORIGIN || "http://localhost:5173",
    credentials: true, // allow the httpOnly auth cookie
  })
);

// General API rate limit — blunt-force abuse protection
app.use(
  "/api",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: "Too many requests, slow down" },
  })
);

app.use(express.json({ limit: "10kb" })); // cap payloads — no megabyte JSON bombs
app.use(cookieParser());
app.use(mongoSanitize()); // strip $ and . operators — NoSQL injection defence

if (process.env.NODE_ENV !== "production") {
  app.use(morgan("dev"));
}

// ── Routes ──────────────────────────────────────────────────────────
// Health reports readiness, not just liveness: the process can be listening
// while the database is still connecting (see index.js / config/db.js).
app.get("/api/health", (req, res) =>
  res.json({ status: "ok", db: isDbReady() ? "connected" : "connecting" })
);

// Readiness gate for database-backed routes. Because the listener now comes up
// before Mongo is connected, there is a short window where these routes cannot
// be served. Answering 503 with Retry-After is the honest response — far better
// than a hung request or a confusing 500. /api/health above stays available so
// tooling can still see the process is alive.
app.use(["/api/auth", "/api/interviews"], (req, res, next) => {
  const rid = req.headers['x-debug-request-id'] || 'no-req-id';
  if (isDbReady()) {
    console.log(`[${new Date().toISOString()}] [${rid}] [app] [readiness] GATE_PASS`, { method: req.method, path: req.path });
    return next();
  }
  console.log(`[${new Date().toISOString()}] [${rid}] [app] [readiness] GATE_503`, { method: req.method, path: req.path });
  res.set("Retry-After", "2");
  res.status(503).json({ message: "Server is starting up, try again in a moment" });
});

app.use("/api/auth", authRoutes);
app.use("/api/interviews", interviewRoutes);

// ── Static client (production only) ─────────────────────────────────
// Serve the built SPA from the same origin as the API. Hashed assets are
// immutable-cacheable forever; index.html is never cached so a new deploy
// takes effect on the next load. Unknown non-API paths fall through to
// index.html — the client router owns them (deep links like /room/:code).
if (isProd && fs.existsSync(clientIndexHtml)) {
  app.use(
    express.static(clientDist, {
      index: false,
      setHeaders(res, filePath) {
        if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        }
      },
    })
  );
  app.get(/^\/(?!api\/).*/, (req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(clientIndexHtml);
  });
}

app.use(notFound);
app.use(errorHandler);

export default app;
