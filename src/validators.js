// Centralized input validation for the /api/lead endpoint.
// Every limit is enforced server-side (never trust the client-side checks in public/index.html).

const LIMITS = {
  MESSAGE_MIN_CHARS: 5,
  MESSAGE_MAX_CHARS: Number(process.env.MAX_MESSAGE_CHARS) || 4000,
  MESSAGE_MAX_WORDS: Number(process.env.MAX_MESSAGE_WORDS) || 600,
  NAME_MAX_CHARS: 120,
  EMAIL_MAX_CHARS: 200,
  PHONE_MAX_CHARS: 30
};

// Loose but effective formats — good enough to reject garbage without rejecting real-world data.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[0-9+()\-.\s]{5,30}$/;

// Strips control/zero-width characters that have no business in a form field
// (also blocks a class of log/email-header injection tricks).
function stripControlChars(str) {
  return String(str).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u200B-\u200F]/g, "");
}

function wordCount(str) {
  const trimmed = str.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

/**
 * Validates and normalizes the raw request body for /api/lead.
 * @returns {{ ok: true, value: object } | { ok: false, error: string }}
 */
export function validateLeadInput(body) {
  const raw = body || {};

  // Honeypot passthrough — caller checks this separately, but keep the field sane.
  const company_website = typeof raw.company_website === "string" ? raw.company_website : "";

  if (typeof raw.message !== "string") {
    return { ok: false, error: "Please include a short message describing what you need." };
  }
  const message = stripControlChars(raw.message).trim();

  if (message.length < LIMITS.MESSAGE_MIN_CHARS) {
    return { ok: false, error: "Please include a short message describing what you need." };
  }
  if (message.length > LIMITS.MESSAGE_MAX_CHARS) {
    return { ok: false, error: `Message is too long (max ${LIMITS.MESSAGE_MAX_CHARS} characters).` };
  }
  if (wordCount(message) > LIMITS.MESSAGE_MAX_WORDS) {
    return { ok: false, error: `Message is too long (max ${LIMITS.MESSAGE_MAX_WORDS} words).` };
  }

  let name;
  if (raw.name !== undefined && raw.name !== null && raw.name !== "") {
    if (typeof raw.name !== "string") return { ok: false, error: "Invalid name." };
    name = stripControlChars(raw.name).trim();
    if (name.length > LIMITS.NAME_MAX_CHARS) {
      return { ok: false, error: `Name is too long (max ${LIMITS.NAME_MAX_CHARS} characters).` };
    }
  }

  let email;
  if (raw.email !== undefined && raw.email !== null && raw.email !== "") {
    if (typeof raw.email !== "string") return { ok: false, error: "Invalid email." };
    email = stripControlChars(raw.email).trim();
    if (email.length > LIMITS.EMAIL_MAX_CHARS || !EMAIL_RE.test(email)) {
      return { ok: false, error: "Please enter a valid email address." };
    }
  }

  let phone;
  if (raw.phone !== undefined && raw.phone !== null && raw.phone !== "") {
    if (typeof raw.phone !== "string") return { ok: false, error: "Invalid phone number." };
    phone = stripControlChars(raw.phone).trim();
    if (phone.length > LIMITS.PHONE_MAX_CHARS || !PHONE_RE.test(phone)) {
      return { ok: false, error: "Please enter a valid phone number." };
    }
  }

  return { ok: true, value: { message, name, email, phone, company_website } };
}

export { LIMITS };
