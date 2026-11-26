export function errorHandler(error, _req, res, _next) {
  const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 600
    ? error.status
    : 500;
  const message = status === 500 ? "Internal server error" : error.message;
  const details = error.details ?? [];

  if (status === 500) console.error(error);
  res.status(status).json({ error: { message, details }, ...(error.attempts ? { attempts: error.attempts } : {}) });
}
