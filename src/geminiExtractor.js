import { withRetry } from "./retry.js";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

// The exact shape we want back from Gemini, every time, no exceptions.
const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string", nullable: true, description: "The lead's full name, if mentioned or signed off." },
    email: { type: "string", nullable: true, description: "The lead's email address, if present in the text." },
    phone: { type: "string", nullable: true, description: "The lead's phone number, if present in the text." },
    company: { type: "string", nullable: true, description: "Company or organization name, if mentioned." },
    service_interested: { type: "string", nullable: true, description: "The product/service the lead is asking about, in a few words." },
    budget: { type: "string", nullable: true, description: "Any budget figure or range mentioned, as written." },
    timeline: { type: "string", nullable: true, description: "Any deadline or timeframe mentioned, as written." },
    requirement_summary: { type: "string", description: "One or two plain-English sentences summarizing what the lead needs." },
    urgency: { type: "string", enum: ["low", "medium", "high"], description: "How urgent the inquiry sounds." },
    sentiment: { type: "string", enum: ["positive", "neutral", "negative"], description: "Overall tone of the message." }
  },
  required: ["requirement_summary", "urgency", "sentiment"]
};

const SYSTEM_INSTRUCTION = `You are a CRM data-entry assistant. You will be given a raw inquiry message
submitted through a business's "contact us" form, possibly along with a name/email/phone the visitor
typed into separate fields. Extract structured lead data from it.

Rules:
- Only use information that is actually present in the text. Do not invent names, emails, phone numbers,
  companies, budgets or timelines that were not stated or implied.
- If a field isn't present, return null for it (except requirement_summary, urgency, sentiment, which are
  always required).
- requirement_summary should be a concise, plain-English description a salesperson can read in 3 seconds.
- Respond with JSON only, matching the provided schema exactly.`;

/**
 * Calls Gemini's generateContent endpoint and returns parsed structured lead data.
 * @param {{ message: string, name?: string, email?: string, phone?: string }} input
 * @returns {Promise<object>} structured fields matching RESPONSE_SCHEMA
 */
export async function extractLead(input) {
  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not set. Add it to your .env file.");
  }

  const contextLines = [
    input.name ? `Name field provided by visitor: ${input.name}` : null,
    input.email ? `Email field provided by visitor: ${input.email}` : null,
    input.phone ? `Phone field provided by visitor: ${input.phone}` : null,
    `Inquiry message:\n"""${input.message}"""`
  ].filter(Boolean);

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

  const body = {
    system_instruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
    contents: [{ role: "user", parts: [{ text: contextLines.join("\n\n") }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
      // Gemini 3.x models ignore temperature/top_p/top_k entirely; thinkingLevel is the
      // supported way to trade off latency/cost vs. reasoning depth. This task is simple
      // field extraction, so "low" is plenty and keeps responses fast and cheap.
      thinkingConfig: {
        thinkingLevel: "low"
      }
    }
  };

  const data = await withRetry(
    async () => {
      let res;
      try {
        res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body)
        });
      } catch (networkErr) {
        // fetch itself threw (DNS, connection reset, timeout) - transient, worth retrying.
        throw networkErr;
      }

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        const err = new Error(`Gemini API error (${res.status}): ${errText}`);
        // 429 (rate limited) and 5xx (upstream trouble) are transient - retry those.
        // Everything else (400 bad request, 401/403 bad key, etc.) will never succeed
        // on retry, so fail fast instead of burning attempts/quota.
        if (res.status !== 429 && res.status < 500) {
          err.noRetry = true;
        }
        throw err;
      }

      return res.json();
    },
    {
      retries: 3,
      baseDelayMs: 500,
      onRetry: (err, attempt, delayMs) => {
        console.warn(`[lead-extractor] Gemini call failed (attempt ${attempt}), retrying in ${delayMs}ms:`, err.message);
      }
    }
  );

  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!text) {
    throw new Error("Gemini returned no extractable content.");
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Gemini response was not valid JSON.");
  }

  // Visitor-provided contact fields win over anything the model guessed from prose,
  // since they were typed directly by the person.
  return {
    name: input.name || parsed.name || null,
    email: input.email || parsed.email || null,
    phone: input.phone || parsed.phone || null,
    company: parsed.company || null,
    service_interested: parsed.service_interested || null,
    budget: parsed.budget || null,
    timeline: parsed.timeline || null,
    requirement_summary: parsed.requirement_summary,
    urgency: parsed.urgency,
    sentiment: parsed.sentiment
  };
}