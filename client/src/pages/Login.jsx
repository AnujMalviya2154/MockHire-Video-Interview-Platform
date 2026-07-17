import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { ApiError } from "../lib/api";
import { Logo, Button, Field, Input, ErrorNote } from "../components/ui";

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
      // (anti-enumeration) — we surface it verbatim, no guessing.
      setError(err instanceof ApiError ? err.message : "Could not sign in");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-ink-50">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <Logo />
        <Link to="/register" className="text-sm font-medium text-accent-600 hover:text-accent-700">
          Create account
        </Link>
      </header>

      <main className="mx-auto flex max-w-md flex-col px-6 pt-10 pb-20">
        <h1 className="text-2xl font-semibold tracking-tight text-ink-900">Welcome back</h1>
        <p className="mt-1.5 text-sm text-ink-500">Sign in to manage your interviews.</p>

        <form onSubmit={onSubmit} className="mt-8 flex flex-col gap-4">
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
            <Input
              type="password"
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

        <p className="mt-6 text-center text-sm text-ink-500">
          New here?{" "}
          <Link to="/register" className="font-medium text-accent-600 hover:text-accent-700">
            Create an account
          </Link>
        </p>
      </main>
    </div>
  );
}
