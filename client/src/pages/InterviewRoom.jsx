import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { api, ApiError } from "../lib/api";
import { Logo, Button, Spinner, StatusBadge } from "../components/ui";

// M4 scope: the room LOBBY. It fetches the interview by room code, which
// the server authorizes to participants only (404 for anyone else, 410 if
// cancelled) — so reaching this screen already proves access control.
// M5 replaces the "waiting area" block with live WebRTC video, chat, and
// the shared code editor.
export default function InterviewRoom() {
  const { roomCode } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [interview, setInterview] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

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
    return <div className="grid min-h-screen place-items-center bg-ink-950"><Spinner /></div>;
  }

  if (error) {
    return (
      <div className="grid min-h-screen place-items-center bg-ink-950 px-6 text-center">
        <div>
          <p className="text-lg font-medium text-white">{error}</p>
          <Button className="mt-5" onClick={() => navigate("/dashboard")}>Back to dashboard</Button>
        </div>
      </div>
    );
  }

  const other =
    String(interview.interviewer?._id) === String(user.id)
      ? interview.candidate
      : interview.interviewer;

  return (
    <div className="flex min-h-screen flex-col bg-ink-950 text-white">
      <header className="flex items-center justify-between border-b border-white/10 px-6 py-4">
        <Logo dark />
        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className="text-sm font-medium">{interview.title}</p>
            <p className="text-xs text-ink-400">with {other?.name}</p>
          </div>
          <Button variant="secondary" onClick={() => navigate("/dashboard")}>Leave</Button>
        </div>
      </header>

      <main className="mx-auto grid w-full max-w-2xl flex-1 place-items-center px-6 py-16 text-center">
        <div>
          <StatusBadge status={interview.status} />
          <h1 className="mt-4 text-2xl font-semibold tracking-tight">You're in the room</h1>
          <p className="mx-auto mt-2 max-w-md text-ink-400">
            Access confirmed for this interview. Live video, chat, and the shared
            code editor connect here in the next step.
          </p>
          <div className="mx-auto mt-8 grid max-w-sm gap-3 text-left">
            <RoomFact label="Interviewer" value={interview.interviewer?.name} />
            <RoomFact label="Candidate" value={interview.candidate?.name} />
            <RoomFact
              label="Scheduled"
              value={new Date(interview.scheduledAt).toLocaleString()}
            />
          </div>
        </div>
      </main>
    </div>
  );
}

function RoomFact({ label, value }) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-white/5 px-4 py-3">
      <span className="text-sm text-ink-400">{label}</span>
      <span className="text-sm font-medium">{value ?? "—"}</span>
    </div>
  );
}
