import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { api, ApiError } from "../lib/api";
import { Logo, Button, StatusBadge, Spinner } from "../components/ui";
import ScheduleModal from "../components/ScheduleModal";
import FeedbackModal from "../components/FeedbackModal";

function formatWhen(iso) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function Dashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const isInterviewer = user?.role === "interviewer";

  const [interviews, setInterviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [feedbackFor, setFeedbackFor] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
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

  async function onCancel(id) {
    if (!confirm("Cancel this interview? This cannot be undone.")) return;
    try {
      await api.cancelInterview(id);
      await load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Could not cancel");
    }
  }

  const now = Date.now();
  const upcoming = interviews.filter(
    (i) => i.status === "scheduled" && new Date(i.scheduledAt).getTime() >= now - 3600e3
  );
  const past = interviews.filter((i) => !upcoming.includes(i));

  return (
    <div className="min-h-screen bg-ink-50">
      <header className="border-b border-ink-100 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Logo />
          <div className="flex items-center gap-4">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium text-ink-900">{user?.name}</p>
              <p className="text-xs capitalize text-ink-500">{user?.role}</p>
            </div>
            <Button variant="secondary" onClick={async () => { await logout(); navigate("/login"); }}>
              Sign out
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-ink-900">Interviews</h1>
            <p className="mt-1 text-sm text-ink-500">
              {isInterviewer
                ? "Schedule and run interviews with your candidates."
                : "Your upcoming and past interview sessions."}
            </p>
          </div>
          {isInterviewer && (
            <Button onClick={() => setScheduleOpen(true)}>
              <span className="text-base leading-none">+</span> Schedule interview
            </Button>
          )}
        </div>

        {error && <p className="mt-6 rounded-lg bg-bad-100 px-4 py-3 text-sm text-bad-600">{error}</p>}

        {loading ? (
          <div className="mt-20 grid place-items-center"><Spinner /></div>
        ) : interviews.length === 0 ? (
          <EmptyState isInterviewer={isInterviewer} onSchedule={() => setScheduleOpen(true)} />
        ) : (
          <div className="mt-8 space-y-10">
            <Section title="Upcoming" count={upcoming.length}>
              {upcoming.map((iv) => (
                <InterviewCard
                  key={iv._id}
                  iv={iv}
                  me={user}
                  onJoin={() => navigate(`/room/${iv.roomCode}`)}
                  onCancel={() => onCancel(iv._id)}
                  onFeedback={() => setFeedbackFor(iv)}
                />
              ))}
              {upcoming.length === 0 && <p className="text-sm text-ink-400">Nothing scheduled.</p>}
            </Section>

            <Section title="Past & completed" count={past.length}>
              {past.map((iv) => (
                <InterviewCard
                  key={iv._id}
                  iv={iv}
                  me={user}
                  onFeedback={() => setFeedbackFor(iv)}
                />
              ))}
              {past.length === 0 && <p className="text-sm text-ink-400">No past interviews yet.</p>}
            </Section>
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

function Section({ title, count, children }) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-400">
        {title} {count > 0 && <span className="text-ink-300">· {count}</span>}
      </h2>
      <div className="grid gap-3">{children}</div>
    </section>
  );
}

function InterviewCard({ iv, me, onJoin, onCancel, onFeedback }) {
  const isInterviewer = String(iv.interviewer?._id) === String(me.id);
  const other = isInterviewer ? iv.candidate : iv.interviewer;
  const joinable = iv.status === "scheduled";
  const canGiveFeedback = isInterviewer && iv.status !== "cancelled";

  return (
    <article className="flex flex-col gap-4 rounded-xl bg-white p-5 shadow-[var(--shadow-card)] sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex items-center gap-2.5">
          <h3 className="truncate font-semibold text-ink-900">{iv.title}</h3>
          <StatusBadge status={iv.status} />
          {iv.status === "completed" && iv.feedback?.result && (
            <StatusBadge status={iv.feedback.result} />
          )}
        </div>
        <p className="mt-1 text-sm text-ink-500">
          {formatWhen(iv.scheduledAt)} · with{" "}
          <span className="font-medium text-ink-700">{other?.name ?? "—"}</span>
          <span className="text-ink-400"> ({isInterviewer ? "candidate" : "interviewer"})</span>
        </p>
        {/* Candidate view: sees the result only, never private comments */}
        {!isInterviewer && iv.feedback?.result && iv.feedback.result !== "pending" && (
          <p className="mt-1 text-sm text-ink-500">
            Result: <span className="font-medium text-ink-700 capitalize">{iv.feedback.result}</span>
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {canGiveFeedback && (
          <Button variant="ghost" onClick={onFeedback}>
            {iv.feedback?.result && iv.feedback.result !== "pending" ? "Edit feedback" : "Feedback"}
          </Button>
        )}
        {joinable && isInterviewer && onCancel && (
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        )}
        {joinable && onJoin && <Button onClick={onJoin}>Join room</Button>}
      </div>
    </article>
  );
}

function EmptyState({ isInterviewer, onSchedule }) {
  return (
    <div className="mt-10 grid place-items-center rounded-2xl border border-dashed border-ink-200 bg-white/50 py-20 text-center">
      <div className="max-w-sm px-6">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-accent-50">
          <svg viewBox="0 0 24 24" className="h-6 w-6 stroke-accent-600" fill="none" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" />
          </svg>
        </span>
        <h3 className="mt-4 font-semibold text-ink-900">No interviews yet</h3>
        <p className="mt-1.5 text-sm text-ink-500">
          {isInterviewer
            ? "Schedule your first interview to get started."
            : "When an interviewer schedules a session with you, it'll appear here."}
        </p>
        {isInterviewer && (
          <Button className="mt-5" onClick={onSchedule}>Schedule interview</Button>
        )}
      </div>
    </div>
  );
}
