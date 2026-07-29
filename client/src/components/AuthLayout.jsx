import { useRef } from "react";
import { Link } from "react-router-dom";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";
import { Logo, ThemeToggle } from "./ui";

// Shared shell for login/register: brand panel (dark register) beside
// the form (product register). Collapses to form-only on small screens.
// The panel shows a compact "call in progress" vignette — the same visual
// language as the landing hero panel and the room's seat tiles, so auth
// feels like a doorway into the product rather than a detached poster.

const CALL = {
  title: "Frontend Round 2",
  clock: "41:12",
  seats: ["Interviewer", "Candidate"],
};

export default function AuthLayout({ title, subtitle, alt, children }) {
  const scope = useRef(null);

  // useGSAP reverts tweens on unmount/re-mount — safe under StrictMode's
  // double-invoke (a killed gsap.from could otherwise strand opacity at 0).
  useGSAP(
    () => {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      gsap.from("[data-stage]", {
        y: 24,
        opacity: 0,
        duration: 0.8,
        stagger: 0.12,
        ease: "power3.out",
      });
    },
    { scope }
  );

  return (
    <div className="grid min-h-[100dvh] lg:grid-cols-[1fr_1.1fr]">
      {/* Brand panel */}
      <aside
        ref={scope}
        className="relative hidden overflow-hidden bg-night-950 text-white lg:flex lg:flex-col lg:justify-between lg:p-10"
      >
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-40 -left-24 h-[30rem] w-[30rem] rounded-full bg-accent-600/25 blur-[120px]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 -top-32 h-80 w-80 rounded-full bg-accent-600/15 blur-[100px]"
        />
        <div className="grain absolute inset-0" aria-hidden />

        <div className="relative" data-stage>
          <Logo dark />
        </div>

        {/* Middle: compact call vignette + the principle it illustrates */}
        <div className="relative max-w-md">
          <div
            data-stage
            className="overflow-hidden rounded-2xl border border-white/10 bg-night-900/80 shadow-[var(--shadow-pop)] backdrop-blur"
          >
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-2.5 text-xs text-white/60">
              <span className="flex items-center gap-2 font-medium">
                <span className="relative flex h-2 w-2">
                  <span className="absolute h-full w-full animate-ping rounded-full bg-live-500/60" />
                  <span className="relative h-2 w-2 rounded-full bg-live-500" />
                </span>
                {CALL.title}
              </span>
              <span className="tabular-nums">{CALL.clock}</span>
            </div>
            <div className="grid grid-cols-2 gap-px bg-white/5">
              {CALL.seats.map((seat) => (
                <div key={seat} className="relative flex aspect-[16/11] flex-col items-center justify-center gap-2 bg-night-950">
                  <span className="grid h-11 w-11 place-items-center rounded-full bg-accent-600/25 ring-1 ring-accent-400/30" aria-hidden>
                    <svg viewBox="0 0 24 24" className="h-5 w-5 stroke-accent-400" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="8.5" r="3.5" />
                      <path d="M5 19.5c1.6-3 4-4.5 7-4.5s5.4 1.5 7 4.5" />
                    </svg>
                  </span>
                  <span className="text-xs text-white/70">{seat}</span>
                </div>
              ))}
            </div>
            <p className="border-t border-white/10 px-4 py-2.5 text-xs text-white/60">
              Room locked to these two identities. A shared link gets nobody in.
            </p>
          </div>

          <blockquote data-stage className="mt-8">
            <p className="font-display text-2xl font-semibold leading-snug tracking-tight">
              "The room is gated by identity, not by a link. That's the way it
              should have always worked."
            </p>
            <footer className="mt-3 text-sm text-white/60">
              The design principle behind MockHire
            </footer>
          </blockquote>
        </div>

        <p className="relative text-xs text-white/50" data-stage>
          Peer-to-peer encrypted video · No recordings, by design
        </p>
      </aside>

      {/* Form panel */}
      <main className="flex flex-col bg-ink-50 px-6 py-6 lg:px-16">
        <header className="flex items-center justify-between gap-3 lg:justify-end">
          <span className="lg:hidden"><Logo /></span>
          <ThemeToggle />
          {alt && (
            <p className="text-sm text-ink-500">
              {alt.text}{" "}
              <Link to={alt.to} className="font-medium text-accent-strong hover:opacity-80 transition-opacity duration-150">
                {alt.cta}
              </Link>
            </p>
          )}
        </header>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">
          <h1 className="font-display text-3xl font-bold tracking-tight text-ink-950">{title}</h1>
          <p className="mt-2 text-sm text-ink-500">{subtitle}</p>
          <div className="mt-8">{children}</div>
        </div>
      </main>
    </div>
  );
}
