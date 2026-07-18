import { useEffect, useReducer } from "react";

// Shared time formatting for the dashboard and room — one vocabulary.

export function formatWhen(iso) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// Compact two-line date-rail parts: ["Mon", "21"]
export function dateRail(iso) {
  const d = new Date(iso);
  return {
    dow: d.toLocaleString(undefined, { weekday: "short" }),
    day: d.toLocaleString(undefined, { day: "numeric" }),
    month: d.toLocaleString(undefined, { month: "short" }),
  };
}

export function timeOnly(iso) {
  return new Date(iso).toLocaleString(undefined, { hour: "numeric", minute: "2-digit" });
}

// "starts in 3h 12m" / "started 5m ago" — for the next-up hero + green room.
export function untilLabel(iso, now = Date.now()) {
  const dt = new Date(iso).getTime() - now;
  const m = Math.round(Math.abs(dt) / 60000);
  if (m < 1) return dt >= 0 ? "starting now" : "started just now";
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  const span = d >= 1 ? `${d}d ${h % 24}h` : h >= 1 ? `${h}h ${m % 60}m` : `${m}m`;
  return dt >= 0 ? `starts in ${span}` : `started ${span} ago`;
}

// Within 15 minutes either side of the scheduled time = "go time".
export function isImminent(iso, now = Date.now()) {
  return Math.abs(new Date(iso).getTime() - now) < 15 * 60000;
}

// Re-render on an interval so countdown labels stay honest.
export function useTick(intervalMs = 30000) {
  const [, force] = useReducer((n) => n + 1, 0);
  useEffect(() => {
    const id = setInterval(force, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
}
