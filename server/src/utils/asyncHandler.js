// Wraps async route handlers so rejected promises reach the Express
// error handler instead of crashing the process (Express 4 doesn't
// catch async errors natively).
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
