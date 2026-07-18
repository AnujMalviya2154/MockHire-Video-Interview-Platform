import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { api, ApiError } from "../lib/api";
import { formatWhen, dateRail, timeOnly, untilLabel, isImminent, useTick } from "../lib/time";
import { Logo, Button, StatusBadge, ListSkeleton } from "../components/ui";
import ScheduleModal from "../components/ScheduleModal";
import FeedbackModal from "../components/FeedbackModal";

export default function Dashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const isInterviewer = user?.role === "interviewer";

  const [interviews, setInterviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [feedbackFor, setFeedbackFor] = useState(null);
  useTick(30000); // keep "starts in…" labels honest

  const load = useCallback(async () => {
    setError("");
    try {
      const d = await api.listInterviews({ limit: 50 });
      setInterviews(d.interviews);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load interviews");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const now = Date.now();
  const upcoming = interviews
    .filter((i) => i.status === "scheduled" && new Date(i.scheduledAt).getTime() >= now - 3600e3)
    .sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt));
  const past = interviews.filter((i) => !upcoming.includes(i));
  const [next, ...laterUpcoming] = upcoming;

  return (
    <div className="min-h-screen bg-ink-50">
      <header className="sticky top-0 z-[var(--z-sticky)] border-b border-ink-200/60 bg-ink-50/80 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3.5">
          <Logo />
          <div className="flex items-center gap-3">
            <div className="hidden items-center gap-2.5 sm:flex">
              <span className="grid h-8 w-8 place-items-center rounded-full bg-accent-100 text-xs font-semibold text-accent-700">
                {initials(user?.name)}
              </span>
              <div className="leading-tight">
                <p className="text-sm font-medium text-ink-900">{user?.name}</p>
                <p className="text-xs capitalize text-ink-500">{user?.role}</p>
              </div>
            </div>
            <Button variant="ghost" onClick={async () => { await logout(); navigate("/login"); }}>
              Sign out
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-3xl font-bold tracking-tight text-ink-950">
              {greeting()}, {user?.name?.split(" ")[0]}
            </h1>
            <p className="mt-1 text-sm text-ink-500">
              {upcoming.length === 0
                ? "Nothing on the calendar."
                : upcoming.length === 1
                  ? "One interview coming up."
                  : `${upcoming.length} interviews coming up.`}
            </p>
          </div>
          {isInterviewer && (
            <Button onClick={() => setScheduleOpen(true)}>
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
              Schedule interview
            </Button>
          )}
        </div>

        {error && (
          <p role="alert" className="mt-6 rounded-lg bg-bad-100 px-4 py-3 text-sm font-medium text-bad-600">
            {error}
          </p>
        )}

        {loading ? (
          <div className="mt-8 space-y-4">
            <div className="skeleton h-36 rounded-2xl" />
            <ListSkeleton rows={3} />
          </div>
        ) : interviews.length === 0 ? (
          <EmptyState isInterviewer={isInterviewer} onSchedule={() => setScheduleOpen(true)} />
        ) : (
          <div className="mt-8 space-y-10">
            {next && (
              <NextUp
                iv={next}
                me={user}
                onJoin={() => navigate(`/room/${next.roomCode}`)}
                onCancelled={load}
              />
            )}

            {laterUpcoming.length > 0 && (
              <Section title="Later">
                <Ledger>
                  {laterUpcoming.map((iv) => (
                    <LedgerRow
                      key={iv._id}
                      iv={iv}
                      me={user}
                      onJoin={() => navigate(`/room/${iv.roomCode}`)}
                      onCancelled={load}
                      onFeedback={() => setFeedbackFor(iv)}
                    />
                  ))}
                </Ledger>
              </Section>
            )}

            {past.length > 0 && (
              <Section title="Past">
                <Ledger>
                  {past.map((iv) => (
                    <LedgerRow key={iv._id} iv={iv} me={user} onFeedback={() => setFeedbackFor(iv)} />
                  ))}
                </Ledger>
              </Section>
            )}
          </div>
        )}
      </main>

      {scheduleOpen && (
        <ScheduleModal
          onClose={() => setScheduleOpen(false)}
          onCreated={async () => { setScheduleOpen(false); await load(); }}
        />
      )}
      {feedbackFor && (
        <FeedbackModal
          interview={feedbackFor}
          onClose={() => setFeedbackFor(null)}
          onSaved={async () => { setFeedbackFor(null); await load(); }}
        />
      )}
    </div>
  );
}

/* ── pieces ────────────────────────────────────────────────────────── */

function initials(name) {
  return name?.split(" ").map((w) => w[0]).slice(0, 2).join("") ?? "—";
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

function Section({ title, children }) {
  return (
    <section>
      <h2 className="mb-2.5 text-sm font-semibold text-ink-700">{title}</h2>
      {children}
    </section>
  );
}

// The one Committed surface on this page: your next session, styled like
// the room it leads to. Everything else stays quiet so this can't be missed.
function NextUp({ iv, me, onJoin, onCancelled }) {
  const isInterviewer = String(iv.interviewer?._id) === String(me.id);
  const other = isInterviewer ? iv.candidate : iv.interviewer;
  const live = isImminent(iv.scheduledAt);

  return (
    <section
      aria-label="Next interview"
      className="relative overflow-hidden rounded-2xl bg-night-950 text-white shadow-[var(--shadow-pop)]"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full bg-accent-600/25 blur-[100px]"
      />
      <div className="grain absolute inset-0" aria-hidden />
      <div className="relative flex flex-col gap-6 p-6 sm:p-8 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm text-white/60">
            {live ? (
              <>
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-live-500 opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-live-500" />
                </span>
                <span className="font-medium text-live-500">Happening now</span>
              </>
            ) : (
              <>Next up · {untilLabel(iv.scheduledAt)}</>
            )}
          </p>
          <h2 className="mt-2 truncate font-display text-2xl font-bold tracking-tight sm:text-3xl">
            {iv.title}
          </h2>
          <p className="mt-1.5 text-sm text-white/60">
            {formatWhen(iv.scheduledAt)} · with{" "}
            <span className="font-medium text-white/90">{other?.name ?? "—"}</span>
            <span className="text-white/60"> ({isInterviewer ? "candidate" : "interviewer"})</span>
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {isInterviewer && <InlineCancel id={iv._id} dark onCancelled={onCancelled} />}
          <Button variant="light" onClick={onJoin}>
            {live ? "Join now" : "Enter room"}
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </Button>
        </div>
      </div>
    </section>
  );
}

// Quiet ledger — date rail + divider rows. Scannable like a calendar,
// not a wall of identical cards.
function Ledger({ children }) {
  return (
    <div className="divide-y divide-ink-100 overflow-hidden rounded-xl bg-white shadow-[var(--shadow-card)]">
      {children}
    </div>
  );
}

function LedgerRow({ iv, me, onJoin, onCancelled, onFeedback }) {
  const isInterviewer = String(iv.interviewer?._id) === String(me.id);
  const other = isInterviewer ? iv.candidate : iv.interviewer;
  const joinable = iv.status === "scheduled" && onJoin;
  const canGiveFeedback = isInterviewer && iv.status !== "cancelled" && onFeedback;
  const rail = dateRail(iv.scheduledAt);
  const done = iv.status !== "scheduled";

  return (
    <article className="group flex items-center gap-4 px-4 py-3.5 transition-colors duration-150 hover:bg-ink-50/70 sm:px-5">
      <div
        className={`grid w-11 shrink-0 place-items-center rounded-lg py-1.5 leading-none ${
          done ? "bg-ink-50 text-ink-400" : "bg-accent-50 text-accent-700"
        }`}
        aria-hidden
      >
        <span className="text-[0.65rem] font-semibold uppercase">{rail.month}</span>
        <span className="mt-0.5 text-lg font-bold tabular-nums">{rail.day}</span>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h3 className={`truncate text-sm font-semibold ${done ? "text-ink-700" : "text-ink-900"}`}>
            {iv.title}
          </h3>
          {done && <StatusBadge status={iv.status} />}
          {iv.status === "completed" && iv.feedback?.result && iv.feedback.result !== "pending" && (
            <StatusBadge status={iv.feedback.result} />
          )}
        </div>
        <p className="mt-0.5 truncate text-sm text-ink-500">
          {timeOnly(iv.scheduledAt)} · {other?.name ?? "—"}
          <span className="text-ink-400"> · {isInterviewer ? "candidate" : "interviewer"}</span>
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        {canGiveFeedback && (
          <Button variant="ghost" className="max-sm:hidden" onClick={onFeedback}>
            {iv.feedback?.result && iv.feedback.result !== "pending" ? "Edit feedback" : "Feedback"}
          </Button>
        )}
        {joinable && isInterviewer && <InlineCancel id={iv._id} onCancelled={onCancelled} />}
        {joinable && (
          <Button variant="secondary" onClick={onJoin}>Join</Button>
        )}
        {canGiveFeedback && !joinable && (
          <Button variant="ghost" className="sm:hidden" onClick={onFeedback} aria-label="Feedback">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
            </svg>
          </Button>
        )}
      </div>
    </article>
  );
}

// Destructive action, no native confirm(): first press arms it, second
// press within 4s commits. Escape hatch is just… waiting.
function InlineCancel({ id, dark = false, onCancelled }) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);

  async function fire() {
    if (!armed) return setArmed(true);
    setBusy(true);
    setError("");
    try {
      await api.cancelInterview(id);
      await onCancelled();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not cancel");
      setBusy(false);
      setArmed(false);
    }
  }

  return (
    <span className="relative inline-flex">
      <Button
        variant={armed ? "danger" : dark ? "ghost-dark" : "ghost"}
        disabled={busy}
        onClick={fire}
        aria-live="polite"
      >
        {busy ? "Cancelling…" : armed ? "Confirm cancel" : "Cancel"}
      </Button>
      {error && (
        <span role="alert" className="absolute -bottom-6 right-0 whitespace-nowrap text-xs font-medium text-bad-600">
          {error}
        </span>
      )}
    </span>
  );
}

function EmptyState({ isInterviewer, onSchedule }) {
  return (
    <div className="mt-10 grid place-items-center rounded-2xl border border-dashed border-ink-200 bg-white/60 py-20 text-center">
      <div className="max-w-sm px-6">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-accent-50">
          <svg viewBox="0 0 24 24" className="h-6 w-6 stroke-accent-600" fill="none" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" />
          </svg>
        </span>
        <h3 className="mt-4 font-display text-lg font-semibold text-ink-900">No interviews yet</h3>
        <p className="mt-1.5 text-sm text-ink-500">
          {isInterviewer
            ? "Schedule your first interview. Your candidate sees it instantly on their dashboard."
            : "When an interviewer schedules a session with you, it'll appear here with a join button."}
        </p>
        {isInterviewer && (
          <Button className="mt-5" onClick={onSchedule}>Schedule interview</Button>
        )}
      </div>
    </div>
  );
}
