import { useState } from "react";
import { api, ApiError } from "../lib/api";
import Modal from "./Modal";
import { Button, Field, ErrorNote } from "./ui";

// Interviewer-only. Records rating (1-5) + verdict + private comments.
// The candidate will only ever see the verdict, never these comments —
// that filtering happens server-side (shapeForViewer), not here.
export default function FeedbackModal({ interview, onClose, onSaved }) {
  const existing = interview.feedback ?? {};
  const [rating, setRating] = useState(existing.rating ?? 0);
  const [result, setResult] = useState(
    existing.result && existing.result !== "pending" ? existing.result : ""
  );
  const [comments, setComments] = useState(existing.comments ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError("");
    if (rating < 1 || rating > 5) return setError("Please give a rating from 1 to 5");
    if (!result) return setError("Please select a verdict");
    setBusy(true);
    try {
      await api.submitFeedback(interview._id, { rating, result, comments });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save feedback");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Interview feedback" onClose={onClose}>
      <p className="-mt-2 mb-4 text-sm text-ink-500">
        {interview.title} · with{" "}
        <span className="font-medium text-ink-700">{interview.candidate?.name}</span>
      </p>
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <ErrorNote>{error}</ErrorNote>

        <Field label="Rating">
          <div className="flex gap-1.5">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                type="button"
                key={n}
                onClick={() => setRating(n)}
                aria-label={`${n} star${n > 1 ? "s" : ""}`}
                aria-pressed={rating >= n}
                className="p-1"
              >
                <svg viewBox="0 0 24 24" className={`h-7 w-7 ${rating >= n ? "fill-warn-600" : "fill-ink-200"}`}>
                  <path d="M12 2l2.9 6.3 6.9.8-5.1 4.7 1.4 6.8L12 17.8 5.9 20.6l1.4-6.8L2.2 9.1l6.9-.8L12 2z" />
                </svg>
              </button>
            ))}
          </div>
        </Field>

        <Field label="Verdict">
          <div className="grid grid-cols-2 gap-3">
            {[
              { value: "pass", label: "Pass", cls: "bg-ok-100 text-ok-600 ring-ok-600" },
              { value: "fail", label: "Fail", cls: "bg-bad-100 text-bad-600 ring-bad-600" },
            ].map((o) => (
              <button
                type="button"
                key={o.value}
                onClick={() => setResult(o.value)}
                aria-pressed={result === o.value}
                className={`rounded-lg py-2.5 text-sm font-medium transition-all ${
                  result === o.value ? `${o.cls} ring-2` : "bg-white text-ink-700 ring-1 ring-ink-200 hover:bg-ink-50"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Private notes (candidate never sees these)">
          <textarea
            maxLength={2000}
            rows={4}
            value={comments}
            onChange={(e) => setComments(e.target.value)}
            placeholder="Strengths, concerns, follow-ups…"
            className="w-full resize-none rounded-lg border-0 bg-white px-3.5 py-2.5 text-sm text-ink-900 shadow-sm ring-1 ring-ink-200 placeholder:text-ink-400 focus:ring-2 focus:ring-accent-600"
          />
        </Field>

        <div className="mt-2 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save feedback"}</Button>
        </div>
      </form>
    </Modal>
  );
}
