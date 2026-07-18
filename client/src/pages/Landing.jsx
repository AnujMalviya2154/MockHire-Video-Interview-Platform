import { useRef, useEffect } from "react";
import { Link } from "react-router-dom";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { magnetize } from "../lib/motion";
import { Logo, Button } from "../components/ui";

gsap.registerPlugin(ScrollTrigger);

const FEATURES = [
  {
    title: "Identity-gated rooms",
    body: "A leaked link is useless. Every join is checked against the interview record, so only the two scheduled people ever get in.",
  },
  {
    title: "Peer-to-peer video",
    body: "Media flows browser-to-browser over encrypted WebRTC. Our servers make the introduction, then get out of the way.",
  },
  {
    title: "Live code, shared",
    body: "A synced code pad inside the room. Run the technical round without tab-switching to a third tool.",
  },
  {
    title: "Verdicts, structured",
    body: "Rating, pass/fail, private notes. Candidates see their result, never the interviewer's raw commentary.",
  },
];

export default function Landing() {
  const scope = useRef(null);
  const heroCtaRef = useRef(null);
  const closingCtaRef = useRef(null);

  // Magnetic pull on the two primary CTAs — pointer-following via
  // gsap.quickTo, cleaned up on unmount, inert under reduced motion.
  useEffect(() => {
    const cleanups = [magnetize(heroCtaRef.current, 0.25), magnetize(closingCtaRef.current, 0.25)];
    return () => cleanups.forEach((fn) => fn());
  }, []);

  useGSAP(
    () => {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

      // Act 1 — headline words rise with a blur settle
      const tl = gsap.timeline({ defaults: { ease: "expo.out" } });
      tl.from("[data-word]", {
        yPercent: 110,
        opacity: 0,
        filter: "blur(6px)",
        duration: 1.1,
        stagger: 0.08,
      })
        .from("[data-hero-sub]", { y: 18, opacity: 0, duration: 0.7 }, "-=0.55")
        .from("[data-hero-cta]", { y: 14, opacity: 0, duration: 0.6, stagger: 0.08 }, "-=0.4")
        .from("[data-panel]", { y: 40, opacity: 0, scale: 0.97, duration: 1 }, "-=0.5")
        .from("[data-panel-glow]", { opacity: 0, duration: 1.4 }, "<");

      // Act 2 — feature rows reveal as they enter, once each
      gsap.utils.toArray("[data-feature]").forEach((el) => {
        gsap.from(el, {
          y: 32,
          opacity: 0,
          duration: 0.8,
          ease: "power3.out",
          scrollTrigger: { trigger: el, start: "top 85%", once: true },
        });
      });
    },
    { scope }
  );

  return (
    <div ref={scope} className="relative min-h-screen overflow-x-clip bg-night-950 text-white">
      {/* ambient brand glow behind the hero */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-64 left-1/2 h-[42rem] w-[42rem] -translate-x-1/2 rounded-full bg-accent-600/25 blur-[140px]"
      />
      <div className="grain absolute inset-0" aria-hidden />

      <header className="relative mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <Logo dark />
        <nav className="flex items-center gap-2">
          <Link to="/login">
            <Button variant="ghost-dark">Sign in</Button>
          </Link>
          <Link to="/register">
            <Button variant="light">Get started</Button>
          </Link>
        </nav>
      </header>

      {/* ── Hero ─────────────────────────────────────────────── */}
      <section className="relative mx-auto max-w-6xl px-6 pt-14 sm:pt-24">
        <h1 className="max-w-4xl font-display text-[clamp(2.75rem,7vw,5.5rem)] font-bold leading-[0.98] tracking-[-0.03em]">
          {/* each word wrapped for the rise animation; overflow clipped per line */}
          <span className="block overflow-hidden pb-1">
            <span data-word className="inline-block">Interviews</span>{" "}
            <span data-word className="inline-block">that</span>
          </span>
          <span className="block overflow-hidden pb-1">
            <span data-word className="inline-block">run</span>{" "}
            <span data-word className="inline-block">like</span>{" "}
            <span data-word className="inline-block text-accent-400">clockwork.</span>
          </span>
        </h1>

        <div className="mt-8 flex max-w-xl flex-col gap-8">
          <p data-hero-sub className="text-lg leading-relaxed text-white/70">
            MockHire puts video, chat, and a live code editor in one
            identity-gated room. Schedule in seconds. Interview without
            friction. Decide with structure.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Link data-hero-cta to="/register">
              <Button ref={heroCtaRef} variant="light" className="px-6 py-3 text-base">
                Start for free
              </Button>
            </Link>
            <Link data-hero-cta to="/login">
              <Button variant="ghost-dark" className="px-6 py-3 text-base">
                I have an account →
              </Button>
            </Link>
          </div>
        </div>

        {/* ── Room preview panel ─────────────────────────────── */}
        <div className="relative mt-20 sm:mt-28">
          <div
            data-panel-glow
            aria-hidden
            className="absolute -inset-x-8 -top-10 h-72 rounded-[3rem] bg-accent-600/20 blur-[100px]"
          />
          <div
            data-panel
            className="relative overflow-hidden rounded-2xl border border-white/10 bg-night-900/80 shadow-[var(--shadow-pop)] backdrop-blur"
          >
            {/* window chrome */}
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-3.5">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
                <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
                <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
              </div>
              <span className="flex items-center gap-2 text-xs font-medium text-white/60">
                <span className="relative flex h-2 w-2">
                  <span className="absolute h-full w-full animate-ping rounded-full bg-live-500/60" />
                  <span className="relative h-2 w-2 rounded-full bg-live-500" />
                </span>
                Frontend Round 2 · 41:12
              </span>
              <span className="w-14" aria-hidden />
            </div>

            <div className="grid gap-px bg-white/5 sm:grid-cols-[1.1fr_1fr]">
              {/* left: video tiles */}
              <div className="grid grid-rows-2 gap-px">
                {[
                  { name: "Riya Sharma", role: "Interviewer" },
                  { name: "Arjun Mehta", role: "Candidate" },
                ].map((p) => (
                  <div key={p.name} className="relative flex aspect-[16/8] items-center justify-center bg-night-950 sm:aspect-auto">
                    <span className="grid h-14 w-14 place-items-center rounded-full bg-accent-600/30 font-display text-lg font-semibold text-accent-400">
                      {p.name.split(" ").map((w) => w[0]).join("")}
                    </span>
                    <span className="absolute bottom-3 left-3 rounded-md bg-black/50 px-2 py-1 text-xs text-white/80">
                      {p.name} · {p.role}
                    </span>
                  </div>
                ))}
              </div>
              {/* right: code pad */}
              <div className="bg-night-950/95 p-5 font-mono text-[13px] leading-6">
                <p className="mb-3 flex items-center justify-between text-xs text-white/60">
                  <span>shared-pad.js</span>
                  <span className="rounded bg-white/10 px-1.5 py-0.5">live</span>
                </p>
                <pre className="text-white/85">
                  <code>{`function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(
      () => fn(...args),
      ms
    );
  };
}`}</code>
                </pre>
                <span className="mt-1 inline-block h-4 w-[7px] animate-pulse bg-accent-400" aria-hidden />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Features: title + body rows, not cards ────────────── */}
      <section className="relative mx-auto max-w-6xl px-6 py-24 sm:py-32">
        <h2 className="font-display text-sm font-semibold uppercase tracking-[0.2em] text-accent-400">
          Why MockHire
        </h2>
        <div className="mt-10 divide-y divide-white/10 border-y border-white/10">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              data-feature
              className="group grid gap-3 py-8 sm:grid-cols-[1fr_1.4fr] sm:gap-8 sm:py-10"
            >
              <h3 className="font-display text-2xl font-semibold tracking-tight transition-colors duration-300 group-hover:text-accent-400">
                {f.title}
              </h3>
              <p className="max-w-prose leading-relaxed text-white/70">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Closing CTA ───────────────────────────────────────── */}
      <section className="relative mx-auto max-w-6xl px-6 pb-28 text-center">
        <h2 className="mx-auto max-w-2xl font-display text-[clamp(2rem,4.5vw,3.5rem)] font-bold leading-tight tracking-[-0.02em]">
          Your next great hire is one room away.
        </h2>
        <Link to="/register" className="mt-8 inline-block">
          <Button ref={closingCtaRef} variant="light" className="px-7 py-3.5 text-base">
            Create your account
          </Button>
        </Link>
      </section>

      <footer className="relative border-t border-white/10 py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-6 text-sm text-white/60 sm:flex-row">
          <Logo dark />
          <p>Built by Anuj Malviya · MERN + WebRTC</p>
        </div>
      </footer>
    </div>
  );
}
