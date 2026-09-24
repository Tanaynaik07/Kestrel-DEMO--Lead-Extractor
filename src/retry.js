/**
 * Retries an async function with exponential backoff + jitter.
 *
 * Only meant for transient failures (network blips, timeouts, 429/5xx from an
 * upstream API). Mark an error `err.noRetry = true` before throwing it if it's
 * something retrying can never fix (bad input, auth failure, etc.) so we fail
 * fast instead of wasting time/quota on doomed attempts.
 *
 * @param {(attempt: number) => Promise<any>} fn - the operation to attempt. Receives the
 *   0-based attempt number.
 * @param {object} [opts]
 * @param {number} [opts.retries=3] - number of retries AFTER the first attempt (so 3 = 4 tries total).
 * @param {number} [opts.baseDelayMs=500] - delay before the first retry.
 * @param {number} [opts.maxDelayMs=8000] - cap on the backoff delay.
 * @param {(err: Error, attempt: number, delayMs: number) => void} [opts.onRetry] - called before each retry, e.g. for logging.
 */
export async function withRetry(fn, opts = {}) {
  const { retries = 3, baseDelayMs = 500, maxDelayMs = 8000, onRetry = () => {} } = opts;

  let attempt = 0;
  while (true) {
    try {
      return await fn(attempt);
    } catch (err) {
      attempt++;
      if (attempt > retries || err.noRetry) {
        throw err;
      }
      const delay = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      const jitter = Math.round(delay * (0.5 + Math.random() * 0.5));
      onRetry(err, attempt, jitter);
      await new Promise((resolve) => setTimeout(resolve, jitter));
    }
  }
}
