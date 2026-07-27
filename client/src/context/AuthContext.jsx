import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { api } from "../lib/api";

// Auth state for the whole app. The session itself lives in an httpOnly
// cookie the JS can't read — this context only mirrors "who am I"
// as reported by GET /auth/me.
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true); // until the first /me resolves

  // Bootstrap: ask the server who we are. A failure here is not an error
  // state — "not logged in" and "server not reachable yet" both simply mean
  // no user, and the route guards send you to /login either way. The 503
  // readiness retry lives in lib/api, so a cold-starting API resolves here
  // rather than flashing a spurious error on first paint.
  useEffect(() => {
    const effectId = Math.random().toString(36).substring(2, 8);
    console.log(`[${new Date().toISOString()}] [client-sys] [AuthContext] [effect] MOUNT`, { effectId, perfNow: performance.now() });
    let cancelled = false;
    console.log(`[${new Date().toISOString()}] [client-sys] [AuthContext] [effect] ME_REQUEST_START`, { effectId, perfNow: performance.now() });
    api
      .me()
      .then((d) => {
        console.log(`[${new Date().toISOString()}] [client-sys] [AuthContext] [effect] ME_REQUEST_RESOLVED`, { effectId, cancelled, user: d.user?._id, perfNow: performance.now() });
        if (!cancelled) setUser(d.user);
      })
      .catch((err) => {
        console.log(`[${new Date().toISOString()}] [client-sys] [AuthContext] [effect] ME_REQUEST_REJECTED`, { effectId, cancelled, error: err.message, perfNow: performance.now() });
        if (!cancelled) setUser(null);
      })
      .finally(() => {
        console.log(`[${new Date().toISOString()}] [client-sys] [AuthContext] [effect] ME_REQUEST_FINALLY`, { effectId, cancelled, perfNow: performance.now() });
        if (!cancelled) setLoading(false);
      });
    return () => {
      console.log(`[${new Date().toISOString()}] [client-sys] [AuthContext] [effect] UNMOUNT`, { effectId, perfNow: performance.now() });
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email, password) => {
    console.log(`[${new Date().toISOString()}] [client-sys] [AuthContext] [login] START`, { perfNow: performance.now() });
    try {
      const d = await api.login({ email, password });
      console.log(`[${new Date().toISOString()}] [client-sys] [AuthContext] [login] RESOLVED`, { userId: d.user?._id, perfNow: performance.now() });
      setUser(d.user);
      return d.user;
    } catch (err) {
      console.log(`[${new Date().toISOString()}] [client-sys] [AuthContext] [login] REJECTED`, { error: err.message, status: err.status, perfNow: performance.now() });
      throw err;
    }
  }, []);

  const register = useCallback(async (payload) => {
    const d = await api.register(payload);
    setUser(d.user);
    return d.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setUser(null); // even if the request fails, drop local state
    }
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
