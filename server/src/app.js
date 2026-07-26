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

// Behind a reverse proxy (Render/Railway/nginx) in production: needed so
// rate limiting sees real client IPs and secure cookies work over TLS.
if (process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}
app.disable("x-powered-by");

// ── Security middleware (order matters) ─────────────────────────────
app.use(helmet()); // secure HTTP headers: CSP, X-Frame-Options, nosniff, HSTS…

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
  if (isDbReady()) return next();
  res.set("Retry-After", "2");
  res.status(503).json({ message: "Server is starting up, try again in a moment" });
});

app.use("/api/auth", authRoutes);
app.use("/api/interviews", interviewRoutes);

app.use(notFound);
app.use(errorHandler);

export default app;
