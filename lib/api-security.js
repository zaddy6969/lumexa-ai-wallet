const RATE_LIMIT_STORE = Symbol.for("lumexa.api.rateLimitStore");

function rateLimitStore() {
  if (!globalThis[RATE_LIMIT_STORE]) globalThis[RATE_LIMIT_STORE] = new Map();
  return globalThis[RATE_LIMIT_STORE];
}

function clientIp(req) {
  const forwarded = String(req.headers?.["x-forwarded-for"] || "")
    .split(",")[0]
    .trim();
  return forwarded || String(req.headers?.["x-real-ip"] || req.socket?.remoteAddress || "unknown");
}

function cleanupStore(store, now) {
  if (store.size < 1000) return;
  for (const [key, entry] of store.entries()) {
    if (entry.resetAt <= now) store.delete(key);
  }
}

export function enforceRateLimit(req, res, { scope, limit, windowMs = 60_000 }) {
  const now = Date.now();
  const store = rateLimitStore();
  cleanupStore(store, now);
  const key = `${scope}:${clientIp(req)}`;
  const current = store.get(key);
  const entry =
    !current || current.resetAt <= now
      ? { count: 1, resetAt: now + windowMs }
      : { count: current.count + 1, resetAt: current.resetAt };

  store.set(key, entry);
  res.setHeader("RateLimit-Limit", String(limit));
  res.setHeader("RateLimit-Remaining", String(Math.max(0, limit - entry.count)));
  res.setHeader("RateLimit-Reset", String(Math.ceil(entry.resetAt / 1000)));

  if (entry.count <= limit) return true;
  res.setHeader("Retry-After", String(Math.max(1, Math.ceil((entry.resetAt - now) / 1000))));
  res.status(429).json({ error: "Too many requests. Please wait and try again." });
  return false;
}

export function rejectCrossSiteRequest(req, res) {
  const origin = String(req.headers?.origin || "").trim();
  if (!origin) return false;

  const forwardedHost = String(req.headers?.["x-forwarded-host"] || "").trim();
  const host = forwardedHost || String(req.headers?.host || "").trim();
  const allowed = new Set(
    [
      host ? `https://${host}` : "",
      host ? `http://${host}` : "",
      process.env.NEXT_PUBLIC_SITE_URL || "",
      process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : ""
    ].filter(Boolean)
  );

  if (allowed.has(origin)) return false;
  res.status(403).json({ error: "Cross-site request rejected." });
  return true;
}

export function hasOversizedJsonBody(req, maxBytes = 32_000) {
  try {
    return Buffer.byteLength(JSON.stringify(req.body || {}), "utf8") > maxBytes;
  } catch {
    return true;
  }
}

export function setNoStore(res) {
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
}
