import test from "node:test";
import assert from "node:assert/strict";
import { validateLeadInput } from "../src/validators.js";

test("accepts a minimal valid message", () => {
  const result = validateLeadInput({ message: "We need help with our AP process." });
  assert.equal(result.ok, true);
  assert.equal(result.value.message, "We need help with our AP process.");
});

test("rejects a missing message", () => {
  const result = validateLeadInput({});
  assert.equal(result.ok, false);
});

test("rejects a non-string message", () => {
  const result = validateLeadInput({ message: 12345 });
  assert.equal(result.ok, false);
});

test("rejects a too-short message", () => {
  const result = validateLeadInput({ message: "hi" });
  assert.equal(result.ok, false);
});

test("rejects a message over the character limit", () => {
  const result = validateLeadInput({ message: "a".repeat(4001) });
  assert.equal(result.ok, false);
  assert.match(result.error, /too long/);
});

test("rejects a message over the word limit", () => {
  const result = validateLeadInput({ message: "word ".repeat(601) });
  assert.equal(result.ok, false);
  assert.match(result.error, /too long/);
});

test("strips control characters from the message", () => {
  const result = validateLeadInput({ message: "Hello\u0000 world, this is fine." });
  assert.equal(result.ok, true);
  assert.ok(!result.value.message.includes("\u0000"));
});

test("accepts a valid email", () => {
  const result = validateLeadInput({ message: "Need a quote please.", email: "jordan@company.com" });
  assert.equal(result.ok, true);
  assert.equal(result.value.email, "jordan@company.com");
});

test("rejects a malformed email", () => {
  const result = validateLeadInput({ message: "Need a quote please.", email: "not-an-email" });
  assert.equal(result.ok, false);
});

test("accepts a valid phone number", () => {
  const result = validateLeadInput({ message: "Call me back please.", phone: "+1 555 010 2938" });
  assert.equal(result.ok, true);
});

test("rejects a phone number with letters", () => {
  const result = validateLeadInput({ message: "Call me back please.", phone: "call-me-maybe" });
  assert.equal(result.ok, false);
});

test("rejects an over-long name", () => {
  const result = validateLeadInput({ message: "Need a quote please.", name: "a".repeat(121) });
  assert.equal(result.ok, false);
});

test("passes through an empty honeypot field", () => {
  const result = validateLeadInput({ message: "Need a quote please.", company_website: "" });
  assert.equal(result.ok, true);
  assert.equal(result.value.company_website, "");
});

test("passes through a filled honeypot field for the caller to check", () => {
  const result = validateLeadInput({ message: "Need a quote please.", company_website: "http://spam.example" });
  assert.equal(result.ok, true);
  assert.equal(result.value.company_website, "http://spam.example");
});
