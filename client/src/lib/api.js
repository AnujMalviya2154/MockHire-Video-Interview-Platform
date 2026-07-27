// Single fetch wrapper for the whole app.
// - credentials: "include" so the httpOnly auth cookie always rides along
// - normalizes errors into ApiError with the server's message
// - no token handling anywhere in JS: the cookie is invisible by design
export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// The request never reached the API (dev proxy refused, server restarting,
// browser offline). Distinguished from ApiError because the two need different
// handling: a NetworkError is worth retrying, a 401 never is.
export class NetworkError extends Error {
  constructor(message = "Cannot reach the server") {
    super(message);
    this.name = "NetworkError";
  }
}

// 503 from the readiness gate means "listening but the database isn't up yet".
// It is the one status worth retrying automatically: it clears in a second or
// two on a cold start and would otherwise surface as a spurious error the very
// first time the app loads.
const RETRY_STATUS = 503;
const RETRY_DELAYS_MS = [400, 900, 1800];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function once(path, { method = "GET", body, reqId } = {}) {
  let res;
  const t0 = performance.now();
  console.log(`[${new Date().toISOString()}] [${reqId}] [api] [once] FETCH_STARTED`, { method, path, perfNow: t0 });
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: "include",
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        "X-Debug-Request-Id": reqId
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    // fetch only rejects on transport failure — never on a 4xx/5xx.
    console.log(`[${new Date().toISOString()}] [${reqId}] [api] [once] FETCH_NETWORK_ERROR`, { method, path, error: err.message, elapsed: performance.now() - t0, perfNow: performance.now() });
    throw new NetworkError();
  }
  console.log(`[${new Date().toISOString()}] [${reqId}] [api] [once] FETCH_COMPLETED`, { method, path, status: res.status, elapsed: performance.now() - t0, perfNow: performance.now() });

  let data = null;
  try {
    data = await res.json();
  } catch {
    /* empty or non-JSON body — handled below */
  }

  if (!res.ok) {
    // A body-less 5xx is the dev proxy's signature when the upstream API died
    // mid-request (e.g. the server restarted). Report it as unreachable rather
    // than inventing an API error the server never sent.
    if (res.status >= 500 && data === null) throw new NetworkError();
    throw new ApiError(res.status, data?.message || `Request failed (${res.status})`);
  }
  return data;
}

async function request(path, opts = {}) {
  const reqId = Math.random().toString(36).substring(2, 10);
  console.log(`[${new Date().toISOString()}] [${reqId}] [api] [request] REQUEST_INITIATED`, { method: opts.method || 'GET', path, perfNow: performance.now() });
  for (let attempt = 0; ; attempt++) {
    try {
      return await once(path, { ...opts, reqId });
    } catch (err) {
      console.log(`[${new Date().toISOString()}] [${reqId}] [api] [request] ATTEMPT_FAILED`, { attempt, error: err.message, status: err.status, perfNow: performance.now() });
      const retriable = err instanceof ApiError && err.status === RETRY_STATUS;
      if (!retriable || attempt >= RETRY_DELAYS_MS.length) {
        console.log(`[${new Date().toISOString()}] [${reqId}] [api] [request] REQUEST_REJECTED`, { attempt, retriable, perfNow: performance.now() });
        throw err;
      }
      console.log(`[${new Date().toISOString()}] [${reqId}] [api] [request] RETRYING`, { waitMs: RETRY_DELAYS_MS[attempt], perfNow: performance.now() });
      await sleep(RETRY_DELAYS_MS[attempt]);
    }
  }
}

export const api = {
  register: (payload) => request("/auth/register", { method: "POST", body: payload }),
  login: (payload) => request("/auth/login", { method: "POST", body: payload }),
  logout: () => request("/auth/logout", { method: "POST" }),
  me: () => request("/auth/me"),

  createInterview: (payload) => request("/interviews", { method: "POST", body: payload }),
  listInterviews: ({ page = 1, limit = 10, status } = {}) =>
    request(
      `/interviews?page=${page}&limit=${limit}${status ? `&status=${status}` : ""}`
    ),
  getRoom: (roomCode) => request(`/interviews/room/${encodeURIComponent(roomCode)}`),
  submitFeedback: (id, payload) =>
    request(`/interviews/${encodeURIComponent(id)}/feedback`, { method: "PATCH", body: payload }),
  cancelInterview: (id) =>
    request(`/interviews/${encodeURIComponent(id)}/cancel`, { method: "PATCH" }),
};
