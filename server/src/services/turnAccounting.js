// M11 Stage 5 — TURN relay accounting loop, 800 GiB cutoff, and 60-second drain.
//
// This module is the ONLY owner of:
//   - relay session tracking (which rooms are actively relay-backed)
//   - cutoff state (in-memory mirror of the persisted budget)
//   - drain lifecycle (60-second grace period for relay-backed rooms)
//
// It does NOT own:
//   - room state / Socket.IO rooms (owned by socket/index.js)
//   - connection-mode telemetry (owned by socket/index.js, Stage 4)
//   - budget persistence / math (owned by turnBudget.js, Stage 2)
//   - ICE credential generation (owned by webrtc.js, Stage 1)
//
// ── Enforcement model ──────────────────────────────────────────────
//
//   1. No new TURN credentials after cutoff (ICE endpoint checks
//      isCutoffActive() || isBudgetExhausted()).
//   2. Server-authoritative drain instruction via Socket.IO.
//   3. Client-side peer teardown for honest clients.
//   4. Credential expiry (8-hour TTL) as a backstop.
//
//   Client non-compliance (e.g. a modified browser ignoring the drain
//   instruction) is an accepted limitation of the portfolio-project
//   architecture. The server cannot forcibly terminate a browser's
//   existing TURN allocation through Socket.IO alone — the credential
//   TTL expiry remains the final enforcement boundary.
//
// ── Injectable clock ───────────────────────────────────────────────
//
//   All time reads go through a `now()` function injected at startup.
//   Production uses `Date.now`. Tests inject a controllable clock so
//   the integration suite never waits 60 real seconds.

import {
  calculateIncrement,
  incrementUsage,
  isBudgetExhausted,
  currentMonthKey,
} from "./turnBudget.js";

// ── Module state ────────────────────────────────────────────────────

/** @type {boolean} In-memory mirror of the persisted cutoff. */
let cutoffReached = false;

/**
 * Tracks active relay-backed rooms and their last-accounted timestamp.
 * @type {Map<string, { lastAccountedAt: number }>}
 */
const relayTracking = new Map();

/**
 * Rooms currently in the 60-second drain grace period.
 * @type {Map<string, { deadline: number, drainGeneration: number }>}
 */
const drainingRooms = new Map();

/** Monotonic generation counter for drain safety. */
let drainGenerationCounter = 0;

/** Prevents overlapping accounting ticks. */
let accountingInProgress = false;

// Injected dependencies
let _io = null;
let _getActiveRoomCodes = null;
let _getRoomConnectionMode = null;
let _now = Date.now;

// Timer handles
let _accountingInterval = null;
let _drainCheckInterval = null;

// Configurable intervals (overridable for tests)
let _accountingIntervalMs = 30_000;
let _drainCheckIntervalMs = 5_000;

// ── Public API ──────────────────────────────────────────────────────

/**
 * Initialize and start the accounting loop.
 *
 * @param {import("socket.io").Server} io - Socket.IO server instance.
 * @param {{ getActiveRoomCodes: () => string[], getRoomConnectionMode: (code: string) => string }} accessors
 * @param {{ now?: () => number, accountingIntervalMs?: number, drainCheckIntervalMs?: number }} [options]
 */
export async function startAccounting(io, accessors, options = {}) {
  _io = io;
  _getActiveRoomCodes = accessors.getActiveRoomCodes;
  _getRoomConnectionMode = accessors.getRoomConnectionMode;
  _now = options.now || Date.now;
  _accountingIntervalMs = options.accountingIntervalMs ?? 30_000;
  _drainCheckIntervalMs = options.drainCheckIntervalMs ?? 5_000;

  // ── Startup initialization (correction #3) ──────────────────────
  // Read persisted usage — a Render restart must never reopen TURN
  // after the monthly budget is already exhausted.
  const exhausted = await isBudgetExhausted(currentMonthKey(new Date(_now())));
  cutoffReached = exhausted;

  if (cutoffReached) {
    console.log("[TURN-ACCOUNTING] Startup: cutoff already reached for current month");
  }

  _accountingInterval = setInterval(() => {
    runAccountingTick().catch((err) =>
      console.error("[TURN-ACCOUNTING] Tick error:", err.message)
    );
  }, _accountingIntervalMs);

  // Drain check only runs when there are draining rooms; started lazily.
}

/**
 * Stop all timers and reset state. Used by tests.
 */
export function stopAccounting() {
  // Flush all remaining relay tracking entries before stopping
  for (const [roomCode, entry] of relayTracking) {
    const elapsed = _now() - entry.lastAccountedAt;
    if (elapsed > 0) {
      const bytes = calculateIncrement(elapsed);
      if (bytes > 0) {
        // Fire-and-forget: we're shutting down
        incrementUsage(bytes, currentMonthKey(new Date(_now()))).catch(() => {});
      }
    }
  }

  clearInterval(_accountingInterval);
  clearInterval(_drainCheckInterval);
  _accountingInterval = null;
  _drainCheckInterval = null;
  cutoffReached = false;
  relayTracking.clear();
  drainingRooms.clear();
  drainGenerationCounter = 0;
  accountingInProgress = false;
  _io = null;
  _getActiveRoomCodes = null;
  _getRoomConnectionMode = null;
  _now = Date.now;
}

/**
 * Synchronous read of the in-memory cutoff flag.
 * Used by the ICE endpoint for a fast-path check.
 */
export function isCutoffActive() {
  return cutoffReached;
}

/**
 * Diagnostics: current accounting state snapshot.
 */
export function getAccountingState() {
  return {
    cutoffReached,
    relayRoomCount: relayTracking.size,
    drainingRoomCount: drainingRooms.size,
    relayRoomCodes: [...relayTracking.keys()],
    drainingRoomCodes: [...drainingRooms.keys()],
  };
}

/**
 * Test-only: manually fire one complete accounting tick.
 * Returns after the tick completes (including async DB operations).
 */
export async function _triggerAccountingTick() {
  await runAccountingTick();
}

// ── Core accounting tick ────────────────────────────────────────────

async function runAccountingTick() {
  if (accountingInProgress) return;
  accountingInProgress = true;

  try {
    const activeRoomCodes = _getActiveRoomCodes();
    const activeSet = new Set(activeRoomCodes);
    const nowMs = _now();

    // ── Step 1: Process each active room ────────────────────────────

    for (const roomCode of activeRoomCodes) {
      // Skip rooms already draining — they've been flushed at drain entry
      if (drainingRooms.has(roomCode)) continue;

      const mode = _getRoomConnectionMode(roomCode);
      const isRelay = mode === "relay";
      const tracked = relayTracking.get(roomCode);

      if (isRelay && tracked) {
        // ── Relay room, already tracked: account elapsed time ───────
        const elapsed = nowMs - tracked.lastAccountedAt;
        if (elapsed > 0) {
          const bytes = calculateIncrement(elapsed);
          if (bytes > 0) {
            await incrementUsage(bytes, currentMonthKey(new Date(nowMs)));
          }
          tracked.lastAccountedAt = nowMs;
        }
      } else if (isRelay && !tracked) {
        // ── Relay room, newly detected: begin tracking ──────────────
        relayTracking.set(roomCode, { lastAccountedAt: nowMs });
      } else if (!isRelay && tracked) {
        // ── Was relay, now not: flush partial interval (correction #4)
        const elapsed = nowMs - tracked.lastAccountedAt;
        if (elapsed > 0) {
          const bytes = calculateIncrement(elapsed);
          if (bytes > 0) {
            await incrementUsage(bytes, currentMonthKey(new Date(nowMs)));
          }
        }
        relayTracking.delete(roomCode);
      }
      // else: not relay, not tracked — nothing to do
    }

    // ── Step 2: Flush rooms that vanished (correction #4) ───────────

    for (const [roomCode, entry] of relayTracking) {
      if (!activeSet.has(roomCode) && !drainingRooms.has(roomCode)) {
        const elapsed = nowMs - entry.lastAccountedAt;
        if (elapsed > 0) {
          const bytes = calculateIncrement(elapsed);
          if (bytes > 0) {
            await incrementUsage(bytes, currentMonthKey(new Date(nowMs)));
          }
        }
        relayTracking.delete(roomCode);
      }
    }

    // ── Step 3: Check cutoff ────────────────────────────────────────

    if (!cutoffReached) {
      const exhausted = await isBudgetExhausted(currentMonthKey(new Date(nowMs)));
      if (exhausted) {
        cutoffReached = true;
        console.log("[TURN-ACCOUNTING] 800 GiB safety cutoff reached");

        // Transition all currently relay-tracked rooms to draining
        for (const [roomCode, entry] of relayTracking) {
          // Flush any remaining time before draining
          const elapsed = nowMs - entry.lastAccountedAt;
          if (elapsed > 0) {
            const bytes = calculateIncrement(elapsed);
            if (bytes > 0) {
              await incrementUsage(bytes, currentMonthKey(new Date(nowMs)));
            }
          }

          drainGenerationCounter += 1;
          drainingRooms.set(roomCode, {
            deadline: nowMs + 60_000,
            drainGeneration: drainGenerationCounter,
          });
          relayTracking.delete(roomCode);

          if (_io) {
            _io.to(roomCode).emit("turn-capacity-drain", {
              deadline: nowMs + 60_000,
            });
          }
        }

        ensureDrainCheckRunning();
      }
    }

    // ── Step 4: Post-cutoff relay transition (mandatory addition) ────
    // A room that was direct at the moment cutoff was reached may later
    // transition to relay (ICE migration/failure). It must still be
    // drained.

    if (cutoffReached) {
      for (const roomCode of activeRoomCodes) {
        if (drainingRooms.has(roomCode)) continue;

        const mode = _getRoomConnectionMode(roomCode);
        if (mode === "relay") {
          // Flush any tracked relay time first
          const tracked = relayTracking.get(roomCode);
          if (tracked) {
            const elapsed = nowMs - tracked.lastAccountedAt;
            if (elapsed > 0) {
              const bytes = calculateIncrement(elapsed);
              if (bytes > 0) {
                await incrementUsage(bytes, currentMonthKey(new Date(nowMs)));
              }
            }
            relayTracking.delete(roomCode);
          }

          drainGenerationCounter += 1;
          drainingRooms.set(roomCode, {
            deadline: nowMs + 60_000,
            drainGeneration: drainGenerationCounter,
          });

          if (_io) {
            _io.to(roomCode).emit("turn-capacity-drain", {
              deadline: nowMs + 60_000,
            });
          }

          ensureDrainCheckRunning();
        }
      }
    }
  } finally {
    accountingInProgress = false;
  }
}

// ── Drain check loop ────────────────────────────────────────────────

function ensureDrainCheckRunning() {
  if (_drainCheckInterval) return;
  _drainCheckInterval = setInterval(() => {
    checkDrainDeadlines();
  }, _drainCheckIntervalMs);
}

function checkDrainDeadlines() {
  const nowMs = _now();

  for (const [roomCode, entry] of drainingRooms) {
    if (nowMs >= entry.deadline) {
      if (_io) {
        _io.to(roomCode).emit("turn-drain-complete");
      }
      drainingRooms.delete(roomCode);
      relayTracking.delete(roomCode); // Ensure no stale tracking
    }
  }

  // Stop the drain check interval when no rooms are draining
  if (drainingRooms.size === 0 && _drainCheckInterval) {
    clearInterval(_drainCheckInterval);
    _drainCheckInterval = null;
  }
}
