// scripts/lib/image-pipeline/retry.ts と同じロジックのプレーンJS版
// （.mjsオーケストレーションスクリプト群はtsx無しで動くためTSを直接importできない）。
export async function withRetry(fn, { maxRetries = 2, onAttemptError } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      onAttemptError?.(err, attempt);
      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
      }
    }
  }
  throw lastError;
}
