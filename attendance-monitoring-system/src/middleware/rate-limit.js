const windows = new Map();
let lastCleanupAt = 0;

function cleanupExpired(now) {
  if (windows.size < 500 && now - lastCleanupAt < 60_000) return;
  for (const [key, value] of windows) {
    if (value.resetAt <= now) windows.delete(key);
  }
  lastCleanupAt = now;
}

export function rateLimit({
  windowMs = 60_000,
  max = 60,
  bucket = "",
  key = (req) => req.ip || req.socket.remoteAddress || "unknown",
} = {}) {
  return (req, res, next) => {
    const now = Date.now();
    cleanupExpired(now);
    const limitKey = `${bucket || `${req.baseUrl}${req.route?.path || req.path}`}:${key(req)}`;
    let state = windows.get(limitKey);
    if (!state || state.resetAt <= now) {
      state = { count: 0, resetAt: now + windowMs };
      windows.set(limitKey, state);
    }
    state.count += 1;
    res.set("RateLimit-Limit", String(max));
    res.set("RateLimit-Remaining", String(Math.max(0, max - state.count)));
    res.set("RateLimit-Reset", String(Math.ceil(state.resetAt / 1000)));
    if (state.count > max) {
      res.set("Retry-After", String(Math.max(1, Math.ceil((state.resetAt - now) / 1000))));
      return res.status(429).json({ error: { message: "Too many requests. Please wait and try again.", details: [] } });
    }
    return next();
  };
}
