import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { gsap } from "gsap";
import { useAuth } from "../context/AuthContext";
import { api, ApiError } from "../lib/api";
import { formatWhen, untilLabel, isImminent, useTick } from "../lib/time";
import { reducedMotion } from "../lib/motion";
import { Logo, Button, Spinner } from "../components/ui";

// M4 scope: the room LOBBY — a green room before going on air. It fetches
// the interview by room code, which the server authorizes to participants
// only (404 for anyone else, 410 if cancelled) — so reaching this screen
// already proves access control. M5 fills the stage with live WebRTC
// video, chat, and the shared code editor.
export default function InterviewRoom() {
  const { roomCode } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [interview, setInterview] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useTick(30000);

  useEffect(() => {
    let cancelled = false;
    api
      .getRoom(roomCode)
      .then((d) => !cancelled && setInterview(d.interview))
      .catch((err) => {
        if (cancelled) return;
        // 404 = not a participant / no such room; 410 = cancelled.
        setError(
          err instanceof ApiError
            ? err.status === 410
              ? "This interview has been cancelled."
              : "You don't have access to this room."
            : "Could not load the room."
        );
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [roomCode]);

  if (loading) {
    return <div className="grid min-h-screen place-items-center bg-night-950"><Spinner /></div>;
  }

  if (error) {
    return (
      <div className="grid min-h-screen place-items-center bg-night-950 px-6 text-center">
        <div>
          <p className="font-display text-xl font-semibold text-white">{error}</p>
          <Button variant="light" className="mt-5" onClick={() => navigate("/dashboard")}>
            Back to dashboard
          </Button>
        </div>
      </div>
    );
  }

  const meIsInterviewer = String(interview.interviewer?._id) === String(user.id);
  const other = meIsInterviewer ? interview.candidate : interview.interviewer;
  const live = isImminent(interview.scheduledAt);

  return (
    <div className="flex min-h-screen flex-col bg-night-950 text-white">
      <header className="flex items-center justify-between border-b border-white/10 px-6 py-4">
        <Logo dark />
        <div className="flex items-center gap-4">
          <p className="hidden text-sm text-white/60 sm:block">
            {interview.title} · with {other?.name}
          </p>
          <Button variant="ghost-dark" onClick={() => navigate("/dashboard")}>Leave</Button>
        </div>
      </header>

      <main className="relative mx-auto grid w-full max-w-4xl flex-1 content-center gap-6 px-6 py-12">
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-1/4 h-[28rem] w-[28rem] -translate-x-1/2 rounded-full bg-accent-600/15 blur-[120px]"
        />
        <div className="grain absolute inset-0" aria-hidden />

        {/* The stage — two seats, waiting. M5 turns these into video tiles. */}
        <SeatStage>
          <Seat person={meIsInterviewer ? interview.interviewer : interview.candidate} you />
          <Seat person={other} />
        </SeatStage>

        {/* Status line under the stage */}
        <div className="relative flex flex-col items-center gap-4 text-center">
          <p className="flex items-center gap-2 text-sm text-white/60">
            {live ? (
              <>
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-live-500 opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-live-500" />
                </span>
                <span className="font-medium text-live-500">It's time</span>
                <span className="text-white/40">·</span>
                <span>video connects here in the next milestone</span>
              </>
            ) : (
              <>
                <svg viewBox="0 0 24 24" className="h-4 w-4 stroke-white/50" fill="none" strokeWidth="1.8" strokeLinecap="round">
                  <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
                </svg>
                {untilLabel(interview.scheduledAt)} · {formatWhen(interview.scheduledAt)}
              </>
            )}
          </p>
          <p className="max-w-md text-sm text-white/50">
            Access confirmed. This room is gated to its two participants;
            live video, chat, and the shared code editor arrive in M5.
          </p>
        </div>
      </main>
    </div>
  );
}

// Entrance choreography for the seat tiles: a quick staggered scale-settle
// when the lobby resolves. Brand surface, runs once, reduced-motion inert.
function SeatStage({ children }) {
  const ref = useRef(null);

  useEffect(() => {
    if (reducedMotion() || !ref.current) return;
    const tween = gsap.from(ref.current.children, {
      y: 26,
      opacity: 0,
      scale: 0.96,
      duration: 0.55,
      stagger: 0.12,
      ease: "power3.out",
      clearProps: "all",
    });
    return () => tween.kill();
  }, []);

  return (
    <div ref={ref} className="relative grid gap-3 sm:grid-cols-2">
      {children}
    </div>
  );
}

// A "seat" — the placeholder that becomes a video tile in M5. 16:10 like
// a call window, initials where the face will be.
function Seat({ person, you = false }) {
  return (
    <figure className="relative aspect-[16/10] overflow-hidden rounded-2xl border border-white/10 bg-night-900">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,oklch(0.23_0.035_278/0.9),transparent_70%)]"
      />
      <div className="absolute inset-0 grid place-items-center">
        <span className="grid h-16 w-16 place-items-center rounded-full bg-accent-600/20 font-display text-xl font-bold text-accent-400 ring-1 ring-accent-400/30">
          {person?.name?.split(" ").map((w) => w[0]).slice(0, 2).join("") ?? "—"}
        </span>
      </div>
      <figcaption className="absolute inset-x-0 bottom-0 flex items-center justify-between px-4 py-2.5 text-sm">
        <span className="font-medium text-white/90">
          {person?.name ?? "—"}
          {you && <span className="ml-1.5 text-white/60">(you)</span>}
        </span>
        <span className="text-xs capitalize text-white/60">{person?.role}</span>
      </figcaption>
    </figure>
  );
}
