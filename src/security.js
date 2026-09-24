import rateLimit from "express-rate-limit";

// Global limiter: blunt protection against scraping / floods across every route,
// including static assets and /api/health.
export const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.RATE_LIMIT_GLOBAL_MAX) || 300,
  standardHeaders: true,
  legacyHeaders: false
});

// Tight limiter on the lead endpoint specifically — this is the only route that costs
// money per request (Gemini call + Sheets write + email send), so it gets its own budget.
export const leadLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: Number(process.env.RATE_LIMIT_LEAD_MAX) || 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many submissions. Please try again in a minute." }
});

/**
 * Optional Origin/Referer allow-list for the lead endpoint. Set ALLOWED_ORIGINS
 * (comma-separated) in production to stop other sites from pointing a hidden form
 * at your API. If unset, this is a no-op (useful for local dev).
 */
export function originGuard(req, res, next) {
  const allowed = (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (allowed.length === 0) return next(); // not configured — skip the check

  const origin = req.headers.origin || req.headers.referer || "";
  const isAllowed = allowed.some((o) => origin.startsWith(o));

  if (!isAllowed) {
    return res.status(403).json({ error: "Request origin not allowed." });
  }
  next();
}
