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

async function request(path, { method = "GET", body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: "include",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  let data = null;
  try {
    data = await res.json();
  } catch {
    /* empty body (shouldn't happen with this API) */
  }

  if (!res.ok) {
    throw new ApiError(res.status, data?.message || "Something went wrong");
  }
  return data;
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
