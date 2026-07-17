import { useState } from "react";
import { api, ApiError } from "../lib/api";
import Modal from "./Modal";
import { Button, Field, Input, ErrorNote } from "./ui";

// Local datetime string for the min attribute — prevents picking a past
// time in the UI. The server independently rejects past times too.
function nowLocalInput() {
  const d = new Date(Date.now() - new Date().getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 16);
}

export default function ScheduleModal({ onClose, onCreated }) {
  const [form, setForm] = useState({
    title: "",
    candidateEmail: "",
    scheduledAt: "",
    description: "",
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function onSubmit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      // Send an ISO string; the server validates the candidate exists,
      // has the candidate role, and the time is in the future.
      await api.createInterview({
        title: form.title,
        candidateEmail: form.candidateEmail,
        description: form.description,
        scheduledAt: new Date(form.scheduledAt).toISOString(),
      });
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not schedule interview");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Schedule interview" onClose={onClose}>
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <ErrorNote>{error}</ErrorNote>
        <Field label="Title">
          <Input required maxLength={120} value={form.title} onChange={set("title")} placeholder="e.g. Frontend Round 1" />
        </Field>
        <Field label="Candidate email">
          <Input
            type="email"
            required
            value={form.candidateEmail}
            onChange={set("candidateEmail")}
            placeholder="candidate@example.com"
          />
        </Field>
        <Field label="Date & time">
          <Input
            type="datetime-local"
            required
            min={nowLocalInput()}
            value={form.scheduledAt}
            onChange={set("scheduledAt")}
          />
        </Field>
        <Field label="Notes (optional)">
          <textarea
            maxLength={1000}
            rows={3}
            value={form.description}
            onChange={set("description")}
            placeholder="Topics to cover, links to share…"
            className="w-full resize-none rounded-lg border-0 bg-white px-3.5 py-2.5 text-sm text-ink-900 shadow-sm ring-1 ring-ink-200 placeholder:text-ink-400 focus:ring-2 focus:ring-accent-600"
          />
        </Field>
        <div className="mt-2 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? "Scheduling…" : "Schedule"}</Button>
        </div>
      </form>
    </Modal>
  );
}
