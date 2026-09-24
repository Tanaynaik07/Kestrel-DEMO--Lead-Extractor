import test from "node:test";
import assert from "node:assert/strict";
import { withRetry } from "../src/retry.js";

test("returns the result on first success without retrying", async () => {
  let calls = 0;
  const result = await withRetry(async () => {
    calls++;
    return "ok";
  });
  assert.equal(result, "ok");
  assert.equal(calls, 1);
});

test("retries a transient failure and eventually succeeds", async () => {
  let calls = 0;
  const result = await withRetry(
    async () => {
      calls++;
      if (calls < 3) throw new Error("transient");
      return "ok";
    },
    { retries: 3, baseDelayMs: 1, maxDelayMs: 2 }
  );
  assert.equal(result, "ok");
  assert.equal(calls, 3);
});

test("gives up after exhausting retries", async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(
      async () => {
        calls++;
        throw new Error("always fails");
      },
      { retries: 2, baseDelayMs: 1, maxDelayMs: 2 }
    )
  );
  assert.equal(calls, 3); // 1 initial attempt + 2 retries
});

test("does not retry an error marked noRetry", async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(
      async () => {
        calls++;
        const err = new Error("permanent");
        err.noRetry = true;
        throw err;
      },
      { retries: 3, baseDelayMs: 1, maxDelayMs: 2 }
    )
  );
  assert.equal(calls, 1);
});

test("calls onRetry with attempt number and delay before each retry", async () => {
  const attempts = [];
  let calls = 0;
  await withRetry(
    async () => {
      calls++;
      if (calls < 2) throw new Error("transient");
      return "ok";
    },
    {
      retries: 2,
      baseDelayMs: 1,
      maxDelayMs: 2,
      onRetry: (err, attempt, delayMs) => attempts.push({ attempt, delayMs })
    }
  );
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].attempt, 1);
});
