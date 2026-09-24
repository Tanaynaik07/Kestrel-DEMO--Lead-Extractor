import { withRetry } from "./retry.js";

const RESEND_API_URL = "https://api.resend.com/emails";

function escapeHtml(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function urgencyColor(urgency) {
  return { high: "#B3261E", medium: "#B8862B", low: "#3C4A4F" }[urgency] || "#3C4A4F";
}

/**
 * Sends a notification email about a new lead to NOTIFY_EMAIL, via the Resend
 * HTTP API (https://resend.com). Uses plain HTTPS rather than SMTP so it
 * works on hosts that block outbound SMTP ports (e.g. Render's free tier).
 * @param {object} lead - structured fields from geminiExtractor, plus rawMessage
 */
export async function sendLeadEmail(lead) {
  const required = ["RESEND_API_KEY", "FROM_EMAIL", "NOTIFY_EMAIL"];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) {
    throw new Error(`Missing email env vars: ${missing.join(", ")}`);
  }

  const rows = [
    ["Name", lead.name],
    ["Email", lead.email],
    ["Phone", lead.phone],
    ["Company", lead.company],
    ["Service interested", lead.service_interested],
    ["Budget", lead.budget],
    ["Timeline", lead.timeline]
  ].filter(([, value]) => value);

  const tableRows = rows
    .map(
      ([label, value]) => `
        <tr>
          <td style="padding:6px 12px 6px 0;color:#3C4A4F;font-size:13px;white-space:nowrap;vertical-align:top;">${escapeHtml(label)}</td>
          <td style="padding:6px 0;color:#10181C;font-size:14px;">${escapeHtml(value)}</td>
        </tr>`
    )
    .join("");

  const html = `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;">
    <div style="border-left:4px solid ${urgencyColor(lead.urgency)};padding:4px 0 4px 14px;margin-bottom:16px;">
      <span style="text-transform:uppercase;font-size:11px;letter-spacing:0.05em;color:${urgencyColor(lead.urgency)};font-weight:bold;">
        ${escapeHtml(lead.urgency || "new")} priority lead
      </span>
      <h2 style="margin:4px 0 0;color:#10181C;">${escapeHtml(lead.requirement_summary || "New inquiry received")}</h2>
    </div>
    <table style="border-collapse:collapse;width:100%;margin-bottom:16px;">${tableRows}</table>
    <div style="background:#F5F1E8;border-radius:6px;padding:14px;">
      <p style="margin:0 0 6px;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;color:#3C4A4F;">Original message</p>
      <p style="margin:0;white-space:pre-wrap;color:#10181C;font-size:14px;">${escapeHtml(lead.rawMessage || "")}</p>
    </div>
    <p style="margin-top:18px;font-size:12px;color:#8a8a8a;">Logged to your leads sheet automatically.</p>
  </div>`;

  const info = await withRetry(
    async () => {
      const res = await fetch(RESEND_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          from: process.env.FROM_EMAIL,
          to: [process.env.NOTIFY_EMAIL],
          reply_to: lead.email || undefined,
          subject: `New lead: ${lead.name || lead.company || "Website inquiry"} (${lead.urgency || "new"} priority)`,
          html
        })
      });

      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        const err = new Error(
          `Resend API error ${res.status}: ${body?.message || res.statusText}`
        );
        // Don't burn retries on errors retrying can never fix - bad/missing
        // API key, unverified sender domain, malformed request, etc. Only
        // retry on rate limiting (429) and upstream server errors (5xx).
        if (res.status !== 429 && res.status < 500) {
          err.noRetry = true;
        }
        throw err;
      }

      return body; // { id: "<resend message id>" }
    },
    {
      retries: 3,
      baseDelayMs: 500,
      onRetry: (err, attempt, delayMs) => {
        console.warn(`[lead-extractor] Email send failed (attempt ${attempt}), retrying in ${delayMs}ms:`, err.message);
      }
    }
  );

  // A 2xx from Resend means the message was accepted for delivery - log it
  // so a successful send is visible here rather than only discoverable by
  // checking every inbox by hand.
  console.log(
    `[lead-extractor] Email accepted by Resend - id: ${info.id}, to: ${process.env.NOTIFY_EMAIL}`
  );
}