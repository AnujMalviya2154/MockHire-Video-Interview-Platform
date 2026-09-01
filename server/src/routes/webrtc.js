// M11 — Authenticated ICE configuration endpoint.
//
// Returns an iceServers array to the client for RTCPeerConnection.
// When Cloudflare TURN credentials are available and the safety budget
// allows, the array contains the existing Google STUN server plus
// Cloudflare TURN entries (UDP + TLS/443). Otherwise it falls back to
// STUN-only.
//
// Permanent Cloudflare secrets (TURN_KEY_API_TOKEN) never leave this
// file. Only short-lived, ephemeral username/credential pairs reach
// the browser.

import { Router } from "express";
import Interview from "../models/Interview.js";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { isCutoffActive } from "../services/turnAccounting.js";
import { isBudgetExhausted } from "../services/turnBudget.js";

const router = Router();

// ── Constants ───────────────────────────────────────────────────────
const GOOGLE_STUN = { urls: "stun:stun.l.google.com:19302" };

// 8-hour maximum credential TTL (in seconds), matching M10 room expiry
const MAX_TTL_SECONDS = 8 * 60 * 60;

// Hard timeout for the Cloudflare API call — prevents blocking room
// entry if the provider is slow or unreachable.
const CF_TIMEOUT_MS = 2500;

// TURN transports to retain after normalizing the provider response.
// Cloudflare does not implement RFC 6062 TCP relaying, and port 53 is
// hostile in many browsers/ISPs. We keep UDP and TURN-over-TLS on 443.
const ALLOWED_TURN_URLS = [
  "turn:turn.cloudflare.com:3478?transport=udp",
  "turns:turn.cloudflare.com:443?transport=tcp",
];

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Calculate the remaining room lifetime in seconds, capped at the
 * 8-hour maximum. Returns null if the interview cannot be found or
 * has already expired.
 */
async function roomTtlSeconds(roomCode) {
  if (!roomCode) return MAX_TTL_SECONDS;
  const interview = await Interview.findOne({ roomCode }).select("scheduledAt").lean();
  if (!interview) return MAX_TTL_SECONDS;

  const EIGHT_HOURS_MS = 8 * 60 * 60 * 1000;
  const expiresAt = new Date(interview.scheduledAt).getTime() + EIGHT_HOURS_MS;
  const remainingMs = expiresAt - Date.now();

  // Room already expired — still return a minimal TTL so the ICE
  // endpoint itself doesn't break; the room-join gate will reject.
  if (remainingMs <= 0) return MAX_TTL_SECONDS;

  const remainingSec = Math.ceil(remainingMs / 1000);
  return Math.min(remainingSec, MAX_TTL_SECONDS);
}

/**
 * Fetch ephemeral TURN credentials from the Cloudflare Realtime API.
 * Uses the /credentials/generate endpoint to support customIdentifier.
 *
 * Returns the raw Cloudflare JSON response or null on any failure.
 */
async function fetchCloudflareCredentials({ ttl, customIdentifier }) {
  const keyId = process.env.TURN_KEY_ID;
  const apiToken = process.env.TURN_KEY_API_TOKEN;

  // Missing config ⇒ STUN-only (expected in dev / before TURN setup)
  if (!keyId || !apiToken) return null;

  const url = `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CF_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ttl, customIdentifier }),
      signal: controller.signal,
    });

    if (!res.ok) {
      console.error(`[TURN] Cloudflare returned ${res.status}`);
      return null;
    }

    const data = await res.json();

    // Sanity-check the response shape
    if (!data?.iceServers) {
      console.error("[TURN] Malformed Cloudflare response — missing iceServers field");
      return null;
    }

    return data;
  } catch (err) {
    if (err.name === "AbortError") {
      console.error(`[TURN] Cloudflare request timed out after ${CF_TIMEOUT_MS}ms`);
    } else {
      console.error("[TURN] Cloudflare request failed:", err.message);
    }
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Extract the username and credential from the Cloudflare response,
 * discarding the provider's URL list in favour of our normalized set.
 *
 * Returns { username, credential } or null if the response is unusable.
 */
function extractCredentials(cfResponse) {
  if (!cfResponse?.iceServers) return null;

  let turnEntry = null;

  if (Array.isArray(cfResponse.iceServers)) {
    // Array shape (e.g., from /generate-ice-servers)
    turnEntry = cfResponse.iceServers.find(
      (entry) => entry.username && entry.credential
    );
  } else if (typeof cfResponse.iceServers === "object") {
    // Object shape (e.g., from /generate)
    if (cfResponse.iceServers.username && cfResponse.iceServers.credential) {
      turnEntry = cfResponse.iceServers;
    }
  }
  if (!turnEntry) {
    console.error("[TURN] Cloudflare response contained no TURN credentials");
    return null;
  }

  return { username: turnEntry.username, credential: turnEntry.credential };
}

/**
 * Build the final normalized iceServers array:
 *  [0] Google STUN (always present)
 *  [1] Cloudflare TURN with filtered transports (when available)
 */
function buildIceServers(credentials) {
  if (!credentials) return [GOOGLE_STUN];

  return [
    GOOGLE_STUN,
    {
      urls: ALLOWED_TURN_URLS,
      username: credentials.username,
      credential: credentials.credential,
    },
  ];
}

// ── Route ───────────────────────────────────────────────────────────

// GET /api/webrtc/ice-servers
// Requires the existing httpOnly JWT cookie (same auth as every other
// API endpoint). Returns an iceServers array suitable for passing
// directly to new RTCPeerConnection({ iceServers }).
router.get(
  "/ice-servers",
  requireAuth,
  asyncHandler(async (req, res) => {
    const roomCode = req.query.roomCode || null;

    // ── Safety budget check (Stage 5) ────────────────────────────
    // Fast path: in-memory flag (survives process lifetime).
    // Slow path: DB read (survives process restart — covers the
    // window between restart and the first accounting tick).
    const exhausted = isCutoffActive() || await isBudgetExhausted();
    if (exhausted) {
      return res.json({ iceServers: [GOOGLE_STUN] });
    }

    // ── TTL calculation ────────────────────────────────────────
    const ttl = await roomTtlSeconds(roomCode);

    // ── Custom identifier for Cloudflare analytics ─────────────
    // Cloudflare enforces an undocumented 64-character limit on this field.
    // roomCode (32) + ":" (1) + userId (24) = 57 characters.
    const customIdentifier = roomCode
      ? `${roomCode}:${req.user._id}`
      : `unknown:${req.user._id}`;

    // ── Fetch credentials ──────────────────────────────────────
    const cfResponse = await fetchCloudflareCredentials({ ttl, customIdentifier });
    const credentials = extractCredentials(cfResponse);
    const iceServers = buildIceServers(credentials);

    res.json({ iceServers });
  })
);

export default router;
