import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { ApiError } from "../lib/api";
import { Logo, Button, Field, Input, ErrorNote } from "../components/ui";

const ROLES = [
  { value: "candidate", label: "Candidate", hint: "I'm being interviewed" },
  { value: "interviewer", label: "Interviewer", hint: "I conduct interviews" },
];

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "candidate" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function onSubmit(e) {
    e.preventDefault();
    setError("");
    // Client-side check mirrors the server's 8-char minimum — UX only;
    // the server validates independently and is the real gate.
    if (form.password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    setBusy(true);
    try {
      await register(form);
      navigate("/dashboard", { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create account");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-ink-50">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <Logo />
        <Link to="/login" className="text-sm font-medium text-accent-600 hover:text-accent-700">
          Sign in
        </Link>
      </header>

      <main className="mx-auto flex max-w-md flex-col px-6 pt-10 pb-20">
        <h1 className="text-2xl font-semibold tracking-tight text-ink-900">Create your account</h1>
        <p className="mt-1.5 text-sm text-ink-500">Start scheduling secure interviews in minutes.</p>

        <form onSubmit={onSubmit} className="mt-8 flex flex-col gap-4">
          <ErrorNote>{error}</ErrorNote>

          <Field label="I am a…">
            <div className="grid grid-cols-2 gap-3">
              {ROLES.map((r) => {
                const active = form.role === r.value;
                return (
                  <button
                    type="button"
                    key={r.value}
                    onClick={() => setForm((f) => ({ ...f, role: r.value }))}
                    aria-pressed={active}
                    className={`rounded-lg px-3 py-3 text-left transition-colors ${
                      active
                        ? "bg-accent-50 ring-2 ring-accent-600"
                        : "bg-white ring-1 ring-ink-200 hover:bg-ink-50"
                    }`}
                  >
                    <span className="block text-sm font-medium text-ink-900">{r.label}</span>
                    <span className="block text-xs text-ink-500">{r.hint}</span>
                  </button>
                );
              })}
            </div>
          </Field>

          <Field label="Full name">
            <Input required maxLength={80} value={form.name} onChange={set("name")} placeholder="Jane Doe" />
          </Field>
          <Field label="Email">
            <Input type="email" autoComplete="email" required value={form.email} onChange={set("email")} placeholder="you@example.com" />
          </Field>
          <Field label="Password">
            <Input
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={form.password}
              onChange={set("password")}
              placeholder="At least 8 characters"
            />
          </Field>

          <Button type="submit" disabled={busy} className="mt-2 w-full">
            {busy ? "Creating account…" : "Create account"}
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-ink-500">
          Already have an account?{" "}
          <Link to="/login" className="font-medium text-accent-600 hover:text-accent-700">
            Sign in
          </Link>
        </p>
      </main>
    </div>
  );
}
