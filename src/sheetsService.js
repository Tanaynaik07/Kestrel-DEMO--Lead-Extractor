import { google } from "googleapis";
import { withRetry } from "./retry.js";

const SHEET_ID = process.env.SHEET_ID;
const SHEET_TAB_NAME = process.env.SHEET_TAB_NAME || "Leads";

const HEADER_ROW = [
  "Timestamp",
  "Name",
  "Email",
  "Phone",
  "Company",
  "Service interested",
  "Budget",
  "Timeline",
  "Urgency",
  "Sentiment",
  "Summary",
  "Raw message"
];

let sheetsClientPromise = null;

function getSheetsClient() {
  if (!sheetsClientPromise) {
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        // Render/Vercel/Railway env vars store \n as a literal backslash-n; turn it back into a real newline.
        private_key: (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n")
      },
      scopes: ["https://www.googleapis.com/auth/spreadsheets"]
    });
    sheetsClientPromise = google.sheets({ version: "v4", auth });
  }
  return sheetsClientPromise;
}

/**
 * Makes sure the target sheet/tab has a header row, creating the tab if it doesn't exist yet.
 */
async function ensureHeader(sheets) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const tabExists = meta.data.sheets.some(
    (s) => s.properties.title === SHEET_TAB_NAME
  );

  if (!tabExists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: {
        requests: [{ addSheet: { properties: { title: SHEET_TAB_NAME } } }]
      }
    });
  }

  const existing = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_TAB_NAME}!A1:L1`
  });

  if (!existing.data.values || existing.data.values.length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_TAB_NAME}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [HEADER_ROW] }
    });
  }
}

/**
 * Appends one lead row to the sheet. Creates the tab + header row on first use.
 * @param {object} lead - structured fields from geminiExtractor, plus the original raw message
 */
export async function appendLeadRow(lead) {
  if (!SHEET_ID || !process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY) {
    throw new Error("Google Sheets credentials are not fully set (SHEET_ID / GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY).");
  }

  const sheets = getSheetsClient();

  const row = [
    new Date().toISOString(),
    lead.name || "",
    lead.email || "",
    lead.phone || "",
    lead.company || "",
    lead.service_interested || "",
    lead.budget || "",
    lead.timeline || "",
    lead.urgency || "",
    lead.sentiment || "",
    lead.requirement_summary || "",
    lead.rawMessage || ""
  ];

  await withRetry(
    async () => {
      // Re-running ensureHeader on a retry is harmless (it no-ops if the tab/header
      // already exist), so we retry the whole append-with-header-check as one unit.
      await ensureHeader(sheets);
      await sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID,
        range: `${SHEET_TAB_NAME}!A1`,
        valueInputOption: "USER_ENTERED",
        insertDataOption: "INSERT_ROWS",
        requestBody: { values: [row] }
      });
    },
    {
      retries: 3,
      baseDelayMs: 500,
      onRetry: (err, attempt, delayMs) => {
        console.warn(`[lead-extractor] Sheets append failed (attempt ${attempt}), retrying in ${delayMs}ms:`, err.message);
      }
    }
  );

  console.log(`[lead-extractor] Wrote lead to sheet ${SHEET_ID}, tab "${SHEET_TAB_NAME}"`);
}