// M11 Stage 2 — TurnUsage accounting tests.
//
// These tests verify the persistence model, atomic increment behavior,
// elapsed-time accounting, month boundaries, numeric safety, and
// concurrency guarantees using the actual MongoDB instance.
//
// Run: node --test server/tests/turn-budget.test.js
//
// Requires MONGO_URI in server/.env (uses the same DB as development).
// Tests create and clean up documents in the "turnusages" collection
// with test-specific month keys to avoid interfering with real data.

import assert from "node:assert/strict";
import { describe, it, before, after, beforeEach } from "node:test";
import mongoose from "mongoose";
import { config } from "dotenv";
import { fileURLToPath } from "url";
import path from "path";

// Load .env from the server directory
const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, "../.env") });

// Import after dotenv so MONGO_URI is available
import TurnUsage from "../src/models/TurnUsage.js";
import {
  CONSERVATIVE_BYTES_PER_SECOND,
  SAFETY_CUTOFF_BYTES,
  currentMonthKey,
  calculateIncrement,
  incrementUsage,
  getUsage,
  isBudgetExhausted,
} from "../src/services/turnBudget.js";

// Test-specific month keys to avoid polluting production data
const TEST_MONTH = "9999-01";
const TEST_MONTH_2 = "9999-02";
const TEST_MONTH_CONCURRENT = "9999-03";
const TEST_MONTH_LARGE = "9999-04";
const TEST_MONTH_EXACT = "9999-05";
const TEST_MONTH_PERSIST = "9999-06";
const ALL_TEST_MONTHS = [
  TEST_MONTH, TEST_MONTH_2, TEST_MONTH_CONCURRENT,
  TEST_MONTH_LARGE, TEST_MONTH_EXACT, TEST_MONTH_PERSIST,
];

// ── MongoDB lifecycle ───────────────────────────────────────────────
before(async () => {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error("MONGO_URI is not set — cannot run DB tests");
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });
});

beforeEach(async () => {
  // Clean test documents before each test suite
  await TurnUsage.deleteMany({ month: { $in: ALL_TEST_MONTHS } });
});

after(async () => {
  // Final cleanup
  await TurnUsage.deleteMany({ month: { $in: ALL_TEST_MONTHS } });
  await mongoose.disconnect();
});

// ── Pure function tests (no DB) ─────────────────────────────────────

describe("currentMonthKey", () => {
  it("returns YYYY-MM format for a known date", () => {
    const key = currentMonthKey(new Date("2026-08-15T12:00:00Z"));
    assert.strictEqual(key, "2026-08");
  });

  it("uses UTC month, not local timezone", () => {
    // Aug 31 at 23:00 UTC is still August in UTC
    const key = currentMonthKey(new Date("2026-08-31T23:59:59Z"));
    assert.strictEqual(key, "2026-08");
  });

  it("rolls to next month at UTC midnight", () => {
    const key = currentMonthKey(new Date("2026-09-01T00:00:00Z"));
    assert.strictEqual(key, "2026-09");
  });

  it("zero-pads single-digit months", () => {
    const key = currentMonthKey(new Date("2026-01-15T00:00:00Z"));
    assert.strictEqual(key, "2026-01");
  });

  it("handles December → January year boundary", () => {
    const dec = currentMonthKey(new Date("2026-12-31T23:59:59Z"));
    const jan = currentMonthKey(new Date("2027-01-01T00:00:00Z"));
    assert.strictEqual(dec, "2026-12");
    assert.strictEqual(jan, "2027-01");
  });
});

describe("calculateIncrement", () => {
  it("computes bytes from elapsed milliseconds", () => {
    // 60 seconds × 250,000 B/s = 15,000,000 bytes
    const result = calculateIncrement(60_000);
    assert.strictEqual(result, 15_000_000);
  });

  it("uses actual elapsed time, not a fixed tick assumption", () => {
    // 47.3 seconds — NOT a round interval
    const result = calculateIncrement(47_300);
    const expected = Math.ceil(47.3 * CONSERVATIVE_BYTES_PER_SECOND);
    assert.strictEqual(result, expected);
  });

  it("handles fractional/short sessions (1 second)", () => {
    const result = calculateIncrement(1_000);
    assert.strictEqual(result, 250_000);
  });

  it("handles sub-second sessions", () => {
    const result = calculateIncrement(500); // 0.5 seconds
    const expected = Math.ceil(0.5 * CONSERVATIVE_BYTES_PER_SECOND);
    assert.strictEqual(result, expected);
    assert.strictEqual(result, 125_000);
  });

  it("returns 0 for zero elapsed time", () => {
    assert.strictEqual(calculateIncrement(0), 0);
  });

  it("returns 0 for negative elapsed time (clock skew protection)", () => {
    assert.strictEqual(calculateIncrement(-5000), 0);
  });

  it("returns 0 for NaN", () => {
    assert.strictEqual(calculateIncrement(NaN), 0);
  });

  it("returns 0 for Infinity", () => {
    assert.strictEqual(calculateIncrement(Infinity), 0);
  });

  it("returns 0 for -Infinity", () => {
    assert.strictEqual(calculateIncrement(-Infinity), 0);
  });

  it("returns an integer (no floating-point drift accumulation)", () => {
    // 33.333 seconds — would produce a non-integer without Math.ceil
    const result = calculateIncrement(33_333);
    assert.ok(Number.isInteger(result), "Result must be an integer");
  });

  it("uses the documented constant (250 KB/s)", () => {
    assert.strictEqual(CONSERVATIVE_BYTES_PER_SECOND, 250_000);
  });
});

// ── MongoDB integration tests ───────────────────────────────────────

describe("incrementUsage (MongoDB)", () => {
  it("creates first usage record for current month via upsert", async () => {
    const result = await incrementUsage(1_000_000, TEST_MONTH);
    assert.strictEqual(result.month, TEST_MONTH);
    assert.strictEqual(result.estimatedTurnSafetyBytes, 1_000_000);
  });

  it("accumulates repeated increments without loss", async () => {
    await incrementUsage(1_000_000, TEST_MONTH);
    await incrementUsage(2_000_000, TEST_MONTH);
    await incrementUsage(500_000, TEST_MONTH);

    const result = await getUsage(TEST_MONTH);
    assert.strictEqual(result.estimatedTurnSafetyBytes, 3_500_000);
  });

  it("returns 0 for a month with no recorded usage", async () => {
    const result = await getUsage(TEST_MONTH_2);
    assert.strictEqual(result.estimatedTurnSafetyBytes, 0);
  });

  it("does not increment for zero bytes", async () => {
    await incrementUsage(1_000_000, TEST_MONTH);
    await incrementUsage(0, TEST_MONTH);
    const result = await getUsage(TEST_MONTH);
    assert.strictEqual(result.estimatedTurnSafetyBytes, 1_000_000);
  });

  it("does not increment for negative bytes", async () => {
    await incrementUsage(1_000_000, TEST_MONTH);
    await incrementUsage(-500, TEST_MONTH);
    const result = await getUsage(TEST_MONTH);
    assert.strictEqual(result.estimatedTurnSafetyBytes, 1_000_000);
  });

  it("does not increment for NaN bytes", async () => {
    await incrementUsage(1_000_000, TEST_MONTH);
    await incrementUsage(NaN, TEST_MONTH);
    const result = await getUsage(TEST_MONTH);
    assert.strictEqual(result.estimatedTurnSafetyBytes, 1_000_000);
  });
});

describe("month boundary isolation", () => {
  it("different months have independent budgets", async () => {
    await incrementUsage(5_000_000, TEST_MONTH);
    await incrementUsage(3_000_000, TEST_MONTH_2);

    const m1 = await getUsage(TEST_MONTH);
    const m2 = await getUsage(TEST_MONTH_2);

    assert.strictEqual(m1.estimatedTurnSafetyBytes, 5_000_000);
    assert.strictEqual(m2.estimatedTurnSafetyBytes, 3_000_000);
  });

  it("previous month does not affect current month", async () => {
    // Simulate heavy usage in the "previous" month
    await incrementUsage(SAFETY_CUTOFF_BYTES, TEST_MONTH);
    assert.ok(await isBudgetExhausted(TEST_MONTH));

    // New month starts fresh
    const fresh = await getUsage(TEST_MONTH_2);
    assert.strictEqual(fresh.estimatedTurnSafetyBytes, 0);
    assert.ok(!(await isBudgetExhausted(TEST_MONTH_2)));
  });
});

describe("restart persistence", () => {
  it("persisted value survives simulated restart (re-read from DB)", async () => {
    // Write a value
    await incrementUsage(42_000_000, TEST_MONTH_PERSIST);

    // Simulate restart: clear Mongoose's query cache by re-reading
    // from MongoDB directly (lean query bypasses any local state)
    const doc = await TurnUsage.findOne({ month: TEST_MONTH_PERSIST }).lean();
    assert.ok(doc, "Document must exist in MongoDB");
    assert.strictEqual(doc.estimatedTurnSafetyBytes, 42_000_000);

    // Further increments build on the persisted value
    await incrementUsage(8_000_000, TEST_MONTH_PERSIST);
    const result = await getUsage(TEST_MONTH_PERSIST);
    assert.strictEqual(result.estimatedTurnSafetyBytes, 50_000_000);
  });
});

describe("concurrent increments (atomic $inc)", () => {
  it("two simultaneous relay-backed rooms do not lose each other's increment", async () => {
    const increment = calculateIncrement(60_000); // 60s × 250KB/s = 15,000,000

    // Fire 10 concurrent increments to stress the atomicity guarantee
    const promises = Array.from({ length: 10 }, () =>
      incrementUsage(increment, TEST_MONTH_CONCURRENT)
    );
    await Promise.all(promises);

    const result = await getUsage(TEST_MONTH_CONCURRENT);
    const expected = increment * 10; // 150,000,000
    assert.strictEqual(
      result.estimatedTurnSafetyBytes,
      expected,
      `Expected ${expected} but got ${result.estimatedTurnSafetyBytes} — concurrent increments lost data`
    );
  });

  it("mixed-size concurrent increments all apply", async () => {
    const increments = [1_000_000, 2_500_000, 750_000, 3_200_000, 100_000];
    const expectedTotal = increments.reduce((a, b) => a + b, 0); // 7,550,000

    const promises = increments.map((bytes) =>
      incrementUsage(bytes, TEST_MONTH_CONCURRENT)
    );
    await Promise.all(promises);

    const result = await getUsage(TEST_MONTH_CONCURRENT);
    assert.strictEqual(result.estimatedTurnSafetyBytes, expectedTotal);
  });
});

describe("large values near 800 GiB", () => {
  it("correctly stores a value just below 800 GiB", async () => {
    const justBelow = SAFETY_CUTOFF_BYTES - 1;
    await incrementUsage(justBelow, TEST_MONTH_LARGE);

    const result = await getUsage(TEST_MONTH_LARGE);
    assert.strictEqual(result.estimatedTurnSafetyBytes, justBelow);
    assert.ok(!(await isBudgetExhausted(TEST_MONTH_LARGE)));
  });

  it("correctly stores exactly 800 GiB", async () => {
    await incrementUsage(SAFETY_CUTOFF_BYTES, TEST_MONTH_EXACT);

    const result = await getUsage(TEST_MONTH_EXACT);
    assert.strictEqual(result.estimatedTurnSafetyBytes, SAFETY_CUTOFF_BYTES);
    assert.ok(await isBudgetExhausted(TEST_MONTH_EXACT));
  });

  it("correctly stores a value above 800 GiB", async () => {
    const above = SAFETY_CUTOFF_BYTES + 1_000_000;
    await incrementUsage(above, TEST_MONTH_LARGE);

    const result = await getUsage(TEST_MONTH_LARGE);
    // Value should be above because $inc is additive
    assert.ok(result.estimatedTurnSafetyBytes >= above);
    assert.ok(await isBudgetExhausted(TEST_MONTH_LARGE));
  });
});

describe("numeric precision safety", () => {
  it("800 GiB in bytes is within Number.MAX_SAFE_INTEGER", () => {
    assert.ok(
      SAFETY_CUTOFF_BYTES < Number.MAX_SAFE_INTEGER,
      `${SAFETY_CUTOFF_BYTES} must be < ${Number.MAX_SAFE_INTEGER}`
    );
  });

  it("SAFETY_CUTOFF_BYTES is exactly 800 * 1024^3", () => {
    assert.strictEqual(SAFETY_CUTOFF_BYTES, 800 * 1024 * 1024 * 1024);
    assert.strictEqual(SAFETY_CUTOFF_BYTES, 858_993_459_200);
  });

  it("incrementing to near-cutoff produces exact integer results", () => {
    // Verify no floating-point drift at large values
    const large = SAFETY_CUTOFF_BYTES - 15_000_000; // just below 800 GiB
    const increment = calculateIncrement(60_000);     // one 60s tick
    const sum = large + increment;
    assert.ok(Number.isSafeInteger(sum), `Sum ${sum} must be a safe integer`);
  });

  it("calculateIncrement always returns a safe integer", () => {
    // Test a range of elapsed times
    const testCases = [1, 100, 1000, 60_000, 3_600_000, 28_800_000];
    for (const ms of testCases) {
      const result = calculateIncrement(ms);
      assert.ok(
        Number.isSafeInteger(result),
        `calculateIncrement(${ms}) = ${result} must be a safe integer`
      );
    }
  });

  it("headroom: MAX_SAFE_INTEGER is >10,000× the cutoff", () => {
    const ratio = Math.floor(Number.MAX_SAFE_INTEGER / SAFETY_CUTOFF_BYTES);
    assert.ok(ratio >= 10_000, `Ratio ${ratio} must be >= 10,000`);
  });
});

describe("isBudgetExhausted", () => {
  it("returns false for zero usage", async () => {
    assert.ok(!(await isBudgetExhausted(TEST_MONTH_2)));
  });

  it("returns false below cutoff", async () => {
    await incrementUsage(100_000_000, TEST_MONTH);
    assert.ok(!(await isBudgetExhausted(TEST_MONTH)));
  });

  it("returns true at exactly the cutoff", async () => {
    await incrementUsage(SAFETY_CUTOFF_BYTES, TEST_MONTH_EXACT);
    assert.ok(await isBudgetExhausted(TEST_MONTH_EXACT));
  });

  it("returns true above the cutoff", async () => {
    await incrementUsage(SAFETY_CUTOFF_BYTES + 1, TEST_MONTH_EXACT);
    assert.ok(await isBudgetExhausted(TEST_MONTH_EXACT));
  });
});

describe("elapsed-time accounting accuracy", () => {
  it("uses actual elapsed time, not timer tick count", () => {
    // If a "60-second" timer fires after 63.2 seconds,
    // the accounting must use 63.2, not 60.
    const actual = calculateIncrement(63_200);
    const naive = calculateIncrement(60_000);
    assert.ok(actual > naive, "Actual elapsed time must produce a higher increment");

    // Verify the exact values
    assert.strictEqual(actual, Math.ceil(63.2 * CONSERVATIVE_BYTES_PER_SECOND));
    assert.strictEqual(naive, Math.ceil(60.0 * CONSERVATIVE_BYTES_PER_SECOND));
  });

  it("accounts for timer drift in short intervals", () => {
    // Timer set for 10s fires at 10.05s
    const drifted = calculateIncrement(10_050);
    const exact = calculateIncrement(10_000);
    assert.ok(drifted >= exact);
  });
});
