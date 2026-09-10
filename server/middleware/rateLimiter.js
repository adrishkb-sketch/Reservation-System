/**
 * Lightweight sliding-window rate limiter for sensitive endpoints
 */
function createRateLimiter({ windowMs = 60 * 1000, maxRequests = 100, message = 'Too many requests, please slow down.' }) {
  const ipStore = new Map();

  // Periodic cleanup
  setInterval(() => {
    const now = Date.now();
    for (const [ip, timestamps] of ipStore.entries()) {
      const valid = timestamps.filter(ts => now - ts < windowMs);
      if (valid.length === 0) {
        ipStore.delete(ip);
      } else {
        ipStore.set(ip, valid);
      }
    }
  }, windowMs);

  return function rateLimiter(req, res, next) {
    const ip = req.ip || req.connection.remoteAddress || '127.0.0.1';
    const now = Date.now();
    const timestamps = (ipStore.get(ip) || []).filter(ts => now - ts < windowMs);

    if (timestamps.length >= maxRequests) {
      return res.status(429).json({ error: message });
    }

    timestamps.push(now);
    ipStore.set(ip, timestamps);
    next();
  };
}

module.exports = {
  createRateLimiter
};
