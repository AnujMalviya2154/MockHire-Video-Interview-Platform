// Small shared primitives — one visual language across the app.
// Product register: Inter, restrained accent, full state vocabulary.
// (Inter is intentional here — product-permitted default; brand
// personality is carried by Bricolage Grotesque on brand surfaces.)
import { useState, forwardRef } from "react";
import { Link } from "react-router-dom";
import { effectiveTheme, toggleTheme } from "../lib/theme";

export function Logo({ dark = false }) {
  return (
    <Link to="/" className="flex items-center gap-2 select-none">
      <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent-600 shadow-[0_2px_8px_oklch(0.54_0.23_278/0.35)]">
        <svg viewBox="0 0 24 24" className="h-4.5 w-4.5 fill-white" aria-hidden>
          <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h7A2.5 2.5 0 0 1 15 7.5v9a2.5 2.5 0 0 1-2.5 2.5h-7A2.5 2.5 0 0 1 3 16.5v-9Z" />
          <path d="M16.5 10.1l3.2-2.2a.8.8 0 0 1 1.3.66v6.88a.8.8 0 0 1-1.3.66l-3.2-2.2v-3.8Z" opacity=".55" />
        </svg>
      </span>
      <span
        className={`font-display text-lg font-bold tracking-tight ${dark ? "text-white" : "text-ink-900"}`}
      >
        MockHire
      </span>
    </Link>
  );
}

export const Button = forwardRef(function Button(
  { variant = "primary", className = "", ...props },
  ref
) {
  const styles = {
    primary:
      "bg-accent-600 text-white hover:bg-accent-700 active:scale-[0.98] disabled:bg-ink-200 disabled:text-ink-400 disabled:active:scale-100",
    secondary:
      "bg-surface text-ink-900 ring-1 ring-ink-200 hover:bg-ink-100 active:scale-[0.98] disabled:text-ink-400",
    danger:
      "bg-bad-600 text-white hover:brightness-110 active:scale-[0.98] disabled:bg-ink-200",
    ghost: "text-ink-700 hover:bg-ink-100 disabled:text-ink-400",
    /* dark-register variants (landing, room) */
    light:
      "bg-white text-night-950 hover:bg-white/90 active:scale-[0.98] disabled:bg-white/30",
    "ghost-dark": "text-white/80 hover:bg-white/10 hover:text-white",
  };
  return (
    <button
      ref={ref}
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-[background-color,color,transform,filter] duration-150 ease-[var(--ease-out-quart)] disabled:cursor-not-allowed ${styles[variant]} ${className}`}
      {...props}
    />
  );
});

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
      className={`w-full rounded-lg border-0 bg-surface px-3.5 py-2.5 text-sm text-ink-900 shadow-sm ring-1 ring-ink-200 transition-shadow duration-150 placeholder:text-ink-500 hover:ring-ink-300 focus:ring-2 focus:ring-accent-600 disabled:bg-ink-100 disabled:text-ink-400 ${className}`}
      {...props}
    />
  );
}

export function Textarea({ className = "", ...props }) {
  return (
    <textarea
      className={`w-full resize-none rounded-lg border-0 bg-surface px-3.5 py-2.5 text-sm text-ink-900 shadow-sm ring-1 ring-ink-200 transition-shadow duration-150 placeholder:text-ink-500 hover:ring-ink-300 focus:ring-2 focus:ring-accent-600 ${className}`}
      {...props}
    />
  );
}

// Password input with reveal toggle — standard affordance, done properly
// (button is type=button so it never submits; label tracks state).
export function PasswordInput(props) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input {...props} type={visible ? "text" : "password"} className="pr-11" />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
        className="absolute inset-y-0 right-0 grid w-11 place-items-center rounded-r-lg text-ink-500 transition-colors duration-150 hover:text-ink-700"
      >
        {visible ? (
          <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
            <circle cx="12" cy="12" r="3" />
            <path d="M4 20 20 4" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        )}
      </button>
    </div>
  );
}

export function ErrorNote({ children }) {
  if (!children) return null;
  return (
    <p role="alert" className="rounded-lg bg-bad-100 px-3.5 py-2.5 text-sm font-medium text-bad-strong">
      {children}
    </p>
  );
}

export function StatusBadge({ status }) {
  const map = {
    scheduled: "bg-accent-50 text-accent-strong",
    completed: "bg-ok-100 text-ok-strong",
    cancelled: "bg-ink-100 text-ink-500",
    pass: "bg-ok-100 text-ok-strong",
    fail: "bg-bad-100 text-bad-strong",
    pending: "bg-warn-100 text-warn-strong",
  };
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${map[status] ?? "bg-ink-100 text-ink-500"}`}
    >
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

// Sun/moon toggle for the product register. State lives on <html> +
// localStorage (lib/theme.js); this button just reflects and flips it.
// aria-pressed = "dark is on", one stable accessible name.
export function ThemeToggle() {
  const [theme, setTheme] = useState(effectiveTheme);
  const dark = theme === "dark";
  return (
    <button
      type="button"
      onClick={() => setTheme(toggleTheme())}
      aria-label="Dark theme"
      aria-pressed={dark}
      title={dark ? "Switch to light" : "Switch to dark"}
      className="grid h-9 w-9 place-items-center rounded-lg text-ink-500 transition-colors duration-150 hover:bg-ink-100 hover:text-ink-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-600"
    >
      {dark ? (
        <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M20.4 14.2A8.5 8.5 0 0 1 9.8 3.6a8.5 8.5 0 1 0 10.6 10.6Z" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      )}
    </button>
  );
}

// Two-option choice rendered as one segmented control — used for the
// register role picker and the feedback verdict. One vocabulary, two uses.
export function SegmentedChoice({ options, value, onChange, label }) {
  return (
    <div
      role="group"
      aria-label={label}
      className="grid grid-cols-2 gap-1 rounded-xl bg-ink-100/80 p-1"
    >
      {options.map((o) => {
        const active = value === o.value;
        return (
          <button
            type="button"
            key={o.value}
            onClick={() => onChange(o.value)}
            aria-pressed={active}
            className={`rounded-lg px-3 py-2.5 text-left transition-all duration-150 ease-[var(--ease-out-quart)] ${
              active
                ? "bg-surface shadow-sm ring-1 ring-ink-200/60"
                : "hover:bg-surface/50"
            }`}
          >
            <span className={`block text-sm font-medium ${active ? (o.activeText ?? "text-ink-900") : "text-ink-700"}`}>
              {o.label}
            </span>
            {o.hint && (
              <span className={`block text-xs ${active ? "text-ink-500" : "text-ink-400"}`}>
                {o.hint}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// Ledger-row skeletons matching the dashboard's list layout.
export function ListSkeleton({ rows = 3 }) {
  return (
    <div className="divide-y divide-ink-100 overflow-hidden rounded-xl bg-surface shadow-[var(--shadow-card)]">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-4 px-5 py-3.5">
          <div className="skeleton h-11 w-11 rounded-lg" />
          <div className="flex-1 space-y-2">
            <div className="skeleton h-3.5 w-1/3" />
            <div className="skeleton h-3 w-1/2" />
          </div>
          <div className="skeleton h-9 w-16 rounded-lg" />
        </div>
      ))}
    </div>
  );
}
