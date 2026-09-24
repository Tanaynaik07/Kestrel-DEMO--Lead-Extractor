# Lead Extractor

An AI-powered lead capture service. A visitor fills out a contact form — even a
messy, free-text one — and Gemini turns it into a clean, structured lead: name,
email, phone, company, and intent. The lead is logged to a Google Sheet and a
notification email goes out, automatically.

**Demo:** https://kestrel-advisory-lead-extractor-1.onrender.com/

---

## How it works

```
Visitor submits form
        │
        ▼
POST /api/lead  ──►  validate + rate-limit
        │
        ▼
  Gemini extracts structured fields
        │
        ├──►  Append row to Google Sheet   (creates tab/header on first run)
        └──►  Send notification email      (Gmail SMTP)
```

Every field falls back gracefully — if a visitor leaves the form fields blank
and just types a paragraph, Gemini infers name, contact info, and company from
the message text itself.

## Features

- **AI field extraction** — Gemini reads the raw submission and returns
  structured lead data, whether the form was filled in properly or not
- **Google Sheets logging** — leads land straight in a spreadsheet, tab and
  header created automatically on first use
- **Email notifications** — an alert fires the moment a new lead comes in
- **Hardened endpoint** — input validation and rate limiting guard `/api/lead`,
  with an optional origin allow-list
- **Resilient by default** — shared exponential-backoff retry logic wraps the
  external calls (Gemini, Sheets, mail)
- **Tested & CI'd** — unit tests for validation and retry logic, run on every
  push via GitHub Actions
- **Dockerized** — one image, ready to deploy anywhere

## Tech stack

Node.js · Express · Google Gemini API · Google Sheets API · Nodemailer (Gmail SMTP) · Docker · GitHub Actions

## Project structure

```
├── server.js              # Express app: serves the page + POST /api/lead
├── src/
│   ├── validators.js      # Input validation — the security boundary for /api/lead
│   ├── security.js        # Rate limiting + optional origin allow-list
│   ├── geminiExtractor.js # Calls Gemini, returns structured lead fields
│   ├── sheetsService.js   # Appends a row to the Google Sheet
│   ├── mailer.js          # Sends the notification email
│   └── retry.js           # Shared exponential-backoff retry helper
├── test/                  # Unit tests for validators + retry
├── public/
│   └── index.html         # The landing page
├── .github/workflows/ci.yml
├── Dockerfile
└── .env.example
```

## Running locally

```bash
npm install
cp .env.example .env   # fill in your Gemini, Sheets, and SMTP credentials
npm start
```

---

Built as a demo of an end-to-end AI lead-capture pipeline — not affiliated with any real business.