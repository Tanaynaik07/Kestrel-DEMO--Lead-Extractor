import "dotenv/config";
import express from "express";
import helmet from "helmet";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractLead } from "./src/geminiExtractor.js";
import { appendLeadRow } from "./src/sheetsService.js";
import { sendLeadEmail } from "./src/mailer.js";
import { validateLeadInput } from "./src/validators.js";
import { globalLimiter, leadLimiter, originGuard } from "./src/security.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

// --- Process-level safety nets ---
// An uncaught synchronous throw means something escaped every try/catch in the
// codebase - safer to log it and let the process manager (Docker/PM2/systemd/
// the host platform) restart a clean instance than to keep running in an
// unknown state.
process.on("uncaughtException", (err) => {
  console.error("[lead-extractor] Uncaught exception, shutting down:", err);
  process.exit(1);
});

// Every async operation in this app (Gemini, Sheets, email) is already wrapped
// in try/catch + withRetry, so this should never fire - it's a backstop in
// case a future change misses one, logged instead of silently swallowed.
process.on("unhandledRejection", (reason) => {
  console.error("[lead-extractor] Unhandled promise rejection:", reason);
});

// --- Fail fast on missing critical config ---
if (!process.env.GEMINI_API_KEY) {
  console.warn("[lead-extractor] WARNING: GEMINI_API_KEY is not set - /api/lead will fail until it is.");
}

// --- Trust proxy ---
// Only trust X-Forwarded-For when explicitly told to (e.g. behind Render/Vercel/Railway/Nginx).
// Trusting it blindly lets a client spoof their own IP and dodge rate limiting.
if (process.env.TRUST_PROXY === "true") {
  app.set("trust proxy", 1);
}

// --- Security headers ---
// CSP is left off here because the landing page uses inline <style>/<script>;
// tighten this (script-src/style-src with nonces) if you move those out of index.html.
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
  })
);

// --- Rate limiting (applies to every route, including static files) ---
app.use(globalLimiter);

app.use(express.json({ limit: "10kb" }));
app.use(express.static(path.join(__dirname, "public"), { maxAge: "1h" }));

app.post("/api/lead", leadLimiter, originGuard, (req, res) => {
  const validation = validateLeadInput(req.body);
  if (!validation.ok) {
    return res.status(400).json({ error: validation.error });
  }
  const { message, name, email, phone, company_website } = validation.value;

  // Honeypot field: real visitors never fill this in; bots often do.
  if (company_website) {
    return res.status(200).json({ ok: true });
  }

  // Confirm to the visitor immediately. Everything past this point (Gemini
  // extraction, Sheets write, email notification) happens in the background
  // with its own retry logic (see src/retry.js) - so a slow/flaky Gemini or
  // Google API call never makes a real submission look like it failed.
  res.json({ ok: true });

  processLead({ message, name, email, phone }).catch((err) => {
    // processLeadInBackground already retries + logs each step individually;
    // this only catches something unexpected in the orchestration itself.
    console.error("[lead-extractor] Unexpected error processing lead:", err);
  });
});

/**
 * Runs after the visitor has already been told "ok". Extracts structured data,
 * then writes to Sheets + sends the notification email (best-effort, in parallel).
 * If Gemini extraction itself fails even after its internal retries, we still
 * save the raw message instead of losing the lead entirely.
 */
async function processLead({ message, name, email, phone }) {
  let lead;
  try {
    const extracted = await extractLead({ message, name, email, phone });
    lead = { ...extracted, rawMessage: message };
  } catch (err) {
    console.error("[lead-extractor] Gemini extraction failed after retries, falling back to raw message only:", err.message || err);
    lead = {
      name: name || null,
      email: email || null,
      phone: phone || null,
      company: null,
      service_interested: null,
      budget: null,
      timeline: null,
      requirement_summary: "(Could not auto-summarize - see raw message)",
      urgency: "medium",
      sentiment: "neutral",
      rawMessage: message
    };
  }

  const results = await Promise.allSettled([appendLeadRow(lead), sendLeadEmail(lead)]);
  results.forEach((result, i) => {
    if (result.status === "rejected") {
      const step = i === 0 ? "Google Sheets" : "email notification";
      console.error(`[lead-extractor] ${step} failed after retries:`, result.reason?.message || result.reason);
    }
  });
}

app.get("/api/health", (_req, res) => res.json({ ok: true }));

// Catch malformed/oversized JSON bodies cleanly instead of a raw 500.
app.use((err, _req, res, next) => {
  if (err.type === "entity.parse.failed" || err.type === "entity.too.large") {
    return res.status(400).json({ error: "Invalid request." });
  }
  next(err);
});

const PORT = process.env.PORT || 4000;
const server = app.listen(PORT, () => {
  console.log(`Lead extractor running on http://localhost:${PORT}`);
});

// Give in-flight requests (e.g. a slow Gemini/Sheets/email round trip that's
// mid-retry) a chance to finish before the process exits, instead of dropping
// them - important on hosts like Render/Railway/Docker that send SIGTERM on
// every redeploy.
function shutdown(signal) {
  console.log(`[lead-extractor] ${signal} received, shutting down gracefully...`);
  server.close(() => {
    console.log("[lead-extractor] Server closed.");
    process.exit(0);
  });
  // Don't hang forever if a connection never closes on its own.
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
