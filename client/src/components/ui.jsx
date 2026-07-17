// Small shared primitives — one visual language across the app.
import { Link } from "react-router-dom";

export function Logo({ dark = false }) {
  return (
    <Link to="/" className="flex items-center gap-2 select-none">
      <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent-600">
        <svg viewBox="0 0 24 24" className="h-4.5 w-4.5 fill-white" aria-hidden>
          <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h7A2.5 2.5 0 0 1 15 7.5v9a2.5 2.5 0 0 1-2.5 2.5h-7A2.5 2.5 0 0 1 3 16.5v-9Z" />
          <path d="M16.5 10.1l3.2-2.2a.8.8 0 0 1 1.3.66v6.88a.8.8 0 0 1-1.3.66l-3.2-2.2v-3.8Z" opacity=".55" />
        </svg>
      </span>
      <span className={`text-lg font-semibold tracking-tight ${dark ? "text-white" : "text-ink-900"}`}>
        MockHire
      </span>
    </Link>
  );
}

export function Button({ variant = "primary", className = "", ...props }) {
  const styles = {
    primary:
      "bg-accent-600 text-white hover:bg-accent-700 disabled:bg-ink-200 disabled:text-ink-400",
    secondary:
      "bg-white text-ink-900 ring-1 ring-ink-200 hover:bg-ink-50 disabled:text-ink-400",
    danger: "bg-bad-600 text-white hover:bg-red-700 disabled:bg-ink-200",
    ghost: "text-ink-700 hover:bg-ink-100 disabled:text-ink-400",
  };
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors disabled:cursor-not-allowed ${styles[variant]} ${className}`}
      {...props}
    />
  );
}

export function Field({ label, error, children }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-ink-700">{label}</span>
      {children}
      {error ? <span className="mt-1 block text-sm text-bad-600">{error}</span> : null}
    </label>
  );
}

export function Input({ className = "", ...props }) {
  return (
    <input
      className={`w-full rounded-lg border-0 bg-white px-3.5 py-2.5 text-sm text-ink-900 shadow-sm ring-1 ring-ink-200 placeholder:text-ink-400 focus:ring-2 focus:ring-accent-600 ${className}`}
      {...props}
    />
  );
}

export function ErrorNote({ children }) {
  if (!children) return null;
  return (
    <p role="alert" className="rounded-lg bg-bad-100 px-3.5 py-2.5 text-sm text-bad-600">
      {children}
    </p>
  );
}

export function StatusBadge({ status }) {
  const map = {
    scheduled: "bg-accent-50 text-accent-700",
    completed: "bg-ok-100 text-ok-600",
    cancelled: "bg-ink-100 text-ink-500",
    pass: "bg-ok-100 text-ok-600",
    fail: "bg-bad-100 text-bad-600",
    pending: "bg-warn-100 text-warn-600",
  };
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${map[status] ?? "bg-ink-100 text-ink-500"}`}>
      {status}
    </span>
  );
}

export function Spinner() {
  return (
    <span
      aria-label="Loading"
      className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-ink-200 border-t-accent-600"
    />
  );
}
