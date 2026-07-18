import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { ApiError } from "../lib/api";
import { Button, Field, Input, ErrorNote, SegmentedChoice, PasswordInput } from "../components/ui";
import AuthLayout from "../components/AuthLayout";

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
    <AuthLayout
      title="Create your account"
      subtitle="Start scheduling secure interviews in minutes."
      alt={{ text: "Already registered?", cta: "Sign in", to: "/login" }}
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <ErrorNote>{error}</ErrorNote>

        <Field label="I am a…">
          <SegmentedChoice
            label="Account role"
            options={ROLES}
            value={form.role}
            onChange={(role) => setForm((f) => ({ ...f, role }))}
          />
        </Field>

        <Field label="Full name">
          <Input required maxLength={80} value={form.name} onChange={set("name")} placeholder="Priya Iyer" />
        </Field>
        <Field label="Email">
          <Input type="email" autoComplete="email" required value={form.email} onChange={set("email")} placeholder="you@example.com" />
        </Field>
        <Field label="Password">
          <PasswordInput
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
    </AuthLayout>
  );
}
