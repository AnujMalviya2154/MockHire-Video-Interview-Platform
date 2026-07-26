import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { ApiError, NetworkError } from "../lib/api";
import { Button, Field, Input, ErrorNote, PasswordInput } from "../components/ui";
import AuthLayout from "../components/AuthLayout";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await login(email, password);
      navigate("/dashboard", { replace: true });
    } catch (err) {
      // Server returns a single generic "Invalid credentials" by design
      // (anti-enumeration) — we surface it verbatim, no guessing. A transport
      // failure is a different problem and gets an honest, actionable message
      // instead of being mislabelled as a credentials error.
      if (err instanceof NetworkError) {
        setError("Can't reach the server. Check it's running, then try again.");
      } else {
        setError(err instanceof ApiError ? err.message : "Could not sign in");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Sign in to manage your interviews."
      alt={{ text: "New here?", cta: "Create an account", to: "/register" }}
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <ErrorNote>{error}</ErrorNote>
        <Field label="Email">
          <Input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </Field>
        <Field label="Password">
          <PasswordInput
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
        </Field>
        <Button type="submit" disabled={busy} className="mt-2 w-full">
          {busy ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </AuthLayout>
  );
}
