import { useRef } from "react";
import { Link } from "react-router-dom";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";
import { Logo, Button } from "../components/ui";

const FEATURES = [
  {
    title: "Secure meeting access",
    body: "Every room is gated by identity, not just a link. Only the scheduled interviewer and candidate can ever join.",
    icon: "M12 2l7 3v6c0 4.5-3 8.6-7 9.9C8 19.6 5 15.5 5 11V5l7-3z",
  },
  {
    title: "Peer-to-peer video",
    body: "WebRTC media flows directly between participants — encrypted end-to-end and never routed through our servers.",
    icon: "M4 6.5A2.5 2.5 0 0 1 6.5 4h7A2.5 2.5 0 0 1 16 6.5v11A2.5 2.5 0 0 1 13.5 20h-7A2.5 2.5 0 0 1 4 17.5v-11zM18 9l3-2v10l-3-2V9z",
  },
  {
    title: "Live coding, together",
    body: "A shared code pad syncs in real time, so you can run a technical round without switching tools.",
    icon: "M8 9l-3 3 3 3M16 9l3 3-3 3M13 7l-2 10",
  },
  {
    title: "Structured feedback",
    body: "Interviewers record a rating and verdict; candidates see their result, never the private notes.",
    icon: "M9 12l2 2 4-4M12 3l7 3v6c0 4.5-3 8.6-7 9.9C8 19.6 5 15.5 5 11V6l7-3z",
  },
];

export default function Landing() {
  const scope = useRef(null);

  useGSAP(
    () => {
      // Respect users who prefer no motion — show everything, no animation.
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        gsap.set("[data-animate]", { opacity: 1, y: 0 });
        return;
      }
      const tl = gsap.timeline({ defaults: { ease: "power3.out", duration: 0.7 } });
      tl.from("[data-animate='hero']", { opacity: 0, y: 24, stagger: 0.12 })
        .from("[data-animate='cta']", { opacity: 0, y: 16 }, "-=0.4")
        .from(
          "[data-animate='card']",
          { opacity: 0, y: 28, stagger: 0.1, duration: 0.6 },
          "-=0.3"
        );
    },
    { scope }
  );

  return (
    <div ref={scope} className="min-h-screen bg-ink-50">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <Logo />
        <nav className="flex items-center gap-2">
          <Link to="/login">
            <Button variant="ghost">Sign in</Button>
          </Link>
          <Link to="/register">
            <Button>Get started</Button>
          </Link>
        </nav>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-3xl px-6 pt-16 pb-14 text-center sm:pt-24">
        <span
          data-animate="hero"
          className="inline-flex items-center gap-2 rounded-full bg-accent-50 px-3 py-1 text-xs font-medium text-accent-700"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-accent-600" />
          Real-time · Secure · Self-hosted
        </span>
        <h1
          data-animate="hero"
          className="mt-5 text-4xl font-semibold leading-[1.1] tracking-tight text-ink-900 sm:text-5xl"
        >
          Run technical interviews that feel effortless.
        </h1>
        <p data-animate="hero" className="mx-auto mt-5 max-w-xl text-lg text-ink-500">
          MockHire brings video, chat, and a live code editor into one secure room —
          scheduled in seconds, protected by design.
        </p>
        <div data-animate="cta" className="mt-8 flex items-center justify-center gap-3">
          <Link to="/register">
            <Button className="px-5 py-3 text-base">Start for free</Button>
          </Link>
          <Link to="/login">
            <Button variant="secondary" className="px-5 py-3 text-base">
              I have an account
            </Button>
          </Link>
        </div>
      </section>

      {/* Feature grid */}
      <section className="mx-auto max-w-5xl px-6 pb-24">
        <div className="grid gap-4 sm:grid-cols-2">
          {FEATURES.map((f) => (
            <article
              key={f.title}
              data-animate="card"
              className="rounded-2xl bg-white p-6 shadow-[var(--shadow-card)]"
            >
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-accent-50">
                <svg viewBox="0 0 24 24" className="h-5 w-5 stroke-accent-600" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d={f.icon} />
                </svg>
              </span>
              <h3 className="mt-4 text-base font-semibold text-ink-900">{f.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-500">{f.body}</p>
            </article>
          ))}
        </div>
      </section>

      <footer className="border-t border-ink-100 py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-6 text-sm text-ink-400 sm:flex-row">
          <Logo />
          <p>Built by Anuj Malviya · MERN + WebRTC</p>
        </div>
      </footer>
    </div>
  );
}
