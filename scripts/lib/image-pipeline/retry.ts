/**
 * 失敗時に最大maxRetries回まで再試行する。無限リトライはしない。
 * 各試行間は軽くバックオフする（429等の瞬間的なレート制限を想定）。
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: { maxRetries?: number; label?: string; onAttemptError?: (err: unknown, attempt: number) => void } = {}
): Promise<T> {
  const maxRetries = options.maxRetries ?? 2;
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      options.onAttemptError?.(err, attempt);
      if (attempt < maxRetries) {
        const backoffMs = 500 * (attempt + 1);
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }
  }

  throw lastError;
}
