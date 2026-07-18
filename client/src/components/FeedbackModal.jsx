import { useState } from "react";
import { api, ApiError } from "../lib/api";
import Modal from "./Modal";
import { Button, Field, Textarea, ErrorNote, SegmentedChoice } from "./ui";

// Interviewer-only. Records rating (1-5) + verdict + private comments.
// The candidate will only ever see the verdict, never these comments —
// that filtering happens server-side (shapeForViewer), not here.

const RATING_WORDS = ["", "Poor", "Weak", "Okay", "Strong", "Outstanding"];

export default function FeedbackModal({ interview, onClose, onSaved }) {
  const existing = interview.feedback ?? {};
  const [rating, setRating] = useState(existing.rating ?? 0);
  const [hovered, setHovered] = useState(0);
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

  const shown = hovered || rating;

  return (
    <Modal title="Interview feedback" onClose={onClose}>
      <p className="-mt-2 mb-4 text-sm text-ink-500">
        {interview.title} · with{" "}
        <span className="font-medium text-ink-700">{interview.candidate?.name}</span>
      </p>
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <ErrorNote>{error}</ErrorNote>

        <Field label="Rating">
          <div className="flex items-center gap-3">
            <div
              className="flex gap-0.5"
              role="radiogroup"
              aria-label="Rating out of 5"
              onMouseLeave={() => setHovered(0)}
            >
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  type="button"
                  key={n}
                  role="radio"
                  aria-checked={rating === n}
                  aria-label={`${n}: ${RATING_WORDS[n]}`}
                  onClick={() => setRating(n)}
                  onMouseEnter={() => setHovered(n)}
                  onFocus={() => setHovered(n)}
                  onBlur={() => setHovered(0)}
                  className="group rounded p-1"
                >
                  <svg
                    viewBox="0 0 24 24"
                    className={`h-7 w-7 transition-[fill,transform] duration-150 ease-[var(--ease-out-quart)] group-active:scale-90 ${
                      shown >= n ? "scale-100 fill-warn-600" : "fill-ink-200"
                    } ${hovered >= n ? "scale-110" : ""}`}
                  >
                    <path d="M12 2l2.9 6.3 6.9.8-5.1 4.7 1.4 6.8L12 17.8 5.9 20.6l1.4-6.8L2.2 9.1l6.9-.8L12 2z" />
                  </svg>
                </button>
              ))}
            </div>
            <span
              aria-hidden
              className={`min-w-24 text-sm font-medium transition-colors duration-150 ${
                shown ? "text-ink-700" : "text-ink-400"
              }`}
            >
              {shown ? RATING_WORDS[shown] : "Pick a rating"}
            </span>
          </div>
        </Field>

        <Field label="Verdict">
          <SegmentedChoice
            label="Verdict"
            value={result}
            onChange={setResult}
            options={[
              { value: "pass", label: "Pass", hint: "Moving forward", activeText: "text-ok-600" },
              { value: "fail", label: "Fail", hint: "Not this time", activeText: "text-bad-600" },
            ]}
          />
        </Field>

        <Field label="Private notes (candidate never sees these)">
          <Textarea
            maxLength={2000}
            rows={4}
            value={comments}
            onChange={(e) => setComments(e.target.value)}
            placeholder="Strengths, concerns, follow-ups…"
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
