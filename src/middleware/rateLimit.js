const buckets = new Map();

function prune(now) {
  if (buckets.size < 500) return;
  for (const [key, row] of buckets) {
    if (now > row.reset) buckets.delete(key);
  }
}

/**
 * In-memory request limiter. Best-effort protection for a single Node process.
 */
export function rateLimit({ windowMs = 60_000, max = 20, key } = {}) {
  return (req, res, next) => {
    const now = Date.now();
    prune(now);
    const id = String((typeof key === 'function' ? key(req) : key) || req.ip || 'unknown');
    let row = buckets.get(id);
    if (!row || now > row.reset) {
      row = { count: 0, reset: now + windowMs };
    }
    row.count += 1;
    buckets.set(id, row);
    if (row.count > max) {
      return res.status(429).json({ error: 'Too many requests. Try again shortly.' });
    }
    return next();
  };
}
