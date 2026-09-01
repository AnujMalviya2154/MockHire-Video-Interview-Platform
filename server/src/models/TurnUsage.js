// M11 Stage 2 — Monthly TURN safety-budget persistence.
//
// TurnUsage stores one document per calendar month, keyed by a
// deterministic "YYYY-MM" string. The estimatedTurnSafetyBytes field
// accumulates a CONSERVATIVE SAFETY ESTIMATE of relay traffic — it is
// intentionally higher than actual Cloudflare egressBytes and exists
// solely to prevent the application from approaching the provider's
// free allowance.
//
// All increments use findOneAndUpdate with $inc to guarantee atomicity
// under concurrent TURN-room accounting. A naïve find→modify→save
// pattern would silently lose concurrent updates.

import mongoose from "mongoose";

const turnUsageSchema = new mongoose.Schema(
  {
    // Deterministic month key: "YYYY-MM" in UTC (e.g. "2026-08")
    // Using UTC avoids timezone-dependent month boundaries.
    month: {
      type: String,
      required: true,
      unique: true,
      match: /^\d{4}-\d{2}$/,
    },

    // Conservative safety estimate of TURN relay bytes for this month.
    //
    // Accumulated via:
    //   elapsedSeconds × CONSERVATIVE_BYTES_PER_SECOND
    //
    // This is NOT Cloudflare's authoritative egressBytes.
    // This is NOT client-reported bandwidth.
    // This is a server-controlled upper-bound estimate.
    //
    // Numeric safety: 800 GiB ≈ 8.59 × 10¹¹ bytes.
    // Number.MAX_SAFE_INTEGER ≈ 9.01 × 10¹⁵ — over 10,000× headroom.
    // MongoDB NumberLong supports 64-bit signed integers (up to 2⁶³).
    // Both JavaScript Number and MongoDB storage are safe for this range.
    estimatedTurnSafetyBytes: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  {
    timestamps: true,
    // Mongoose will name the collection "turnusages"
  }
);

export default mongoose.model("TurnUsage", turnUsageSchema);
