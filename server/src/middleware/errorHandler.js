export function notFound(req, res) {
  res.status(404).json({ message: "Route not found" });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  const rid = req.headers['x-debug-request-id'] || 'no-req-id';
  console.log(`[${new Date().toISOString()}] [${rid}] [error_mid] [errorHandler] CAUGHT_ERROR`, { name: err.name, message: err.message, code: err.code });
  // Mongoose duplicate key (e.g. unique email) — safe, specific message
  if (err.code === 11000) {
    return res.status(409).json({ message: "Resource already exists" });
  }
  // Mongoose validation errors — expose only the messages, not internals
  if (err.name === "ValidationError") {
    const message = Object.values(err.errors)
      .map((e) => e.message)
      .join(", ");
    return res.status(400).json({ message });
  }
  if (err.name === "CastError") {
    return res.status(400).json({ message: "Invalid identifier" });
  }

  console.error(err); // full detail server-side only
  const status = err.statusCode || 500;
  // Never leak stack traces or internal error text to the client in production
  const message =
    status === 500 && process.env.NODE_ENV === "production"
      ? "Internal server error"
      : err.message || "Internal server error";
  res.status(status).json({ message });
}
