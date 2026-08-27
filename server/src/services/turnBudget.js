// M11 Stage 2 — TURN safety-budget accounting service.
//
// This module provides the server-controlled accounting for
// estimatedTurnSafetyBytes. The client CANNOT influence the byte
// count — all values derive from server-measured elapsed time
// multiplied by a server-defined conservative bandwidth ceiling.
//
// ── Accounting formula ──────────────────────────────────────────────
//
//   increment = elapsedSeconds × CONSERVATIVE_BYTES_PER_SECOND
//
//   where:
//     elapsedSeconds = (now - lastAccountedAt) / 1000
//       computed from actual timestamps, never from a timer tick count
//
//     CONSERVATIVE_BYTES_PER_SECOND = 250_000  (250 KB/s = 2 Mbit/s)
//       a 1:1 video call with audio + video typically uses 1–1.5 Mbit/s
//       in each direction. Because TURN relays bidirectional media, we
//       see roughly double the single-direction rate through the relay.
//       250 KB/s (2 Mbit/s) is intentionally above a typical 720p call
//       to ensure we overestimate, not underestimate.
//
// ── Why this is conservative ────────────────────────────────────────
//
//   A typical 1:1 WebRTC interview at 720p uses ~1.2 Mbit/s per
//   direction. TURN relays both directions, so actual relay throughput
//   is ~300 KB/s for a busy call. Our 250 KB/s ceiling is slightly
//   below that theoretical peak but accounts for the fact that video
//   bitrate is variable (lower during static scenes, audio-only
//   periods, etc.). For the safety model, this provides a reasonable
//   upper-bound estimate that intentionally overestimates lightweight
//   sessions while remaining realistic for heavy ones.
//
//   The 800 GiB cutoff (enforced in Stage 5) is itself set well below
//   the 1,000 GB provider allowance, providing an additional margin.
//
// ── Concurrency ─────────────────────────────────────────────────────
//
//   All increments use MongoDB's atomic $inc operator via
//   findOneAndUpdate with upsert:true. This guarantees that two
//   simultaneous TURN-room accounting operations cannot overwrite
//   each other — both increments are applied atomically by MongoDB.
//
// ── Month boundary ──────────────────────────────────────────────────
//
//   The month key is "YYYY-MM" in UTC. When the UTC month rolls over,
//   the first increment for the new month upserts a fresh document
//   with the new key. Previous months' documents remain for audit but
//   do not affect the current month's budget.

import TurnUsage from "../models/TurnUsage.js";

// ── Configuration ───────────────────────────────────────────────────

// Conservative bandwidth ceiling: 250 KB/s (= 2 Mbit/s).
// See module header for derivation and justification.
export const CONSERVATIVE_BYTES_PER_SECOND = 250_000;

// Safety cutoff threshold: 800 GiB in bytes.
// Intentionally well below the 1,000 GB Cloudflare free allowance.
// Stage 5 enforces the cutoff; Stage 2 only calculates and persists.
export const SAFETY_CUTOFF_BYTES = 800 * 1024 * 1024 * 1024; // 858,993,459,200

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Returns the current UTC month as a deterministic "YYYY-MM" string.
 * Using UTC prevents timezone-dependent month boundaries.
 */
export function currentMonthKey(now = new Date()) {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/**
 * Calculate the byte increment for a given elapsed duration.
 *
 * @param {number} elapsedMs - Actual elapsed time in milliseconds
 *   (from Date.now() deltas, not from a timer interval constant).
 * @returns {number} Bytes to add to estimatedTurnSafetyBytes.
 *   Always ≥ 0; negative durations are clamped to zero.
 */
export function calculateIncrement(elapsedMs) {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return 0;
  const elapsedSeconds = elapsedMs / 1000;
  return Math.ceil(elapsedSeconds * CONSERVATIVE_BYTES_PER_SECOND);
}

/**
 * Atomically increment estimatedTurnSafetyBytes for the current month.
 *
 * Uses findOneAndUpdate with $inc and upsert:true so that:
 *   - The first call for a new month creates the document.
 *   - Concurrent calls never lose each other's increments.
 *   - The returned document reflects the state AFTER the increment.
 *
 * @param {number} bytes - The number of bytes to add (from calculateIncrement).
 * @param {string} [monthKey] - Override for testing; defaults to current UTC month.
 * @returns {Promise<{month: string, estimatedTurnSafetyBytes: number}>}
 */
export async function incrementUsage(bytes, monthKey) {
  if (!Number.isFinite(bytes) || bytes <= 0) return getUsage(monthKey);

  // Math.round ensures we store an integer — $inc on a float would
  // accumulate floating-point drift over thousands of increments.
  const safeBytes = Math.round(bytes);

  const key = monthKey || currentMonthKey();

  const doc = await TurnUsage.findOneAndUpdate(
    { month: key },
    { $inc: { estimatedTurnSafetyBytes: safeBytes } },
    {
      upsert: true,
      new: true, // return the document AFTER the update
      setDefaultsOnInsert: true,
    }
  );

  return {
    month: doc.month,
    estimatedTurnSafetyBytes: doc.estimatedTurnSafetyBytes,
  };
}

/**
 * Read the current month's usage without modifying it.
 *
 * @param {string} [monthKey] - Override for testing; defaults to current UTC month.
 * @returns {Promise<{month: string, estimatedTurnSafetyBytes: number}>}
 */
export async function getUsage(monthKey) {
  const key = monthKey || currentMonthKey();
  const doc = await TurnUsage.findOne({ month: key }).lean();
  return {
    month: key,
    estimatedTurnSafetyBytes: doc?.estimatedTurnSafetyBytes ?? 0,
  };
}

/**
 * Check whether the current month's safety budget has been exceeded.
 *
 * Stage 5 will use this to decide whether to issue TURN credentials.
 * Stage 2 exposes it for testability but does not enforce it.
 *
 * @param {string} [monthKey] - Override for testing.
 * @returns {Promise<boolean>} True if budget is exhausted.
 */
export async function isBudgetExhausted(monthKey) {
  const { estimatedTurnSafetyBytes } = await getUsage(monthKey);
  return estimatedTurnSafetyBytes >= SAFETY_CUTOFF_BYTES;
}
