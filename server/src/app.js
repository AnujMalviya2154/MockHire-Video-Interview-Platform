import express from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import mongoSanitize from "express-mongo-sanitize";
import morgan from "morgan";

import authRoutes from "./routes/auth.js";
import interviewRoutes from "./routes/interviews.js";
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
app.get("/api/health", (req, res) => res.json({ status: "ok" }));
app.use("/api/auth", authRoutes);
app.use("/api/interviews", interviewRoutes);

app.use(notFound);
app.use(errorHandler);

export default app;
