const WINDOW_MS = 60_000;
const MAX_REQUESTS = 3;

interface RateLimitState {
  count: number;
  windowStart: number;
}

/**
 * IPアドレスをキーにしたゆるいレート制限（1分あたり3回程度）。
 * KVは結果整合性のため厳密な同時実行制御はできないが、Turnstile/honeypotと
 * 組み合わせた多層防御の一部として許容する。IPアドレス自体はKVにのみ保存し、
 * D1（問い合わせデータ）には保存しない。永久ブロックはしない（ウィンドウは60秒でリセット）。
 */
export async function checkRateLimit(
  kv: KVNamespace,
  ip: string
): Promise<{ allowed: boolean }> {
  const key = `rl:${ip}`;
  const now = Date.now();

  const raw = await kv.get(key);
  let state: RateLimitState = { count: 0, windowStart: now };
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as RateLimitState;
      if (now - parsed.windowStart < WINDOW_MS) {
        state = parsed;
      }
    } catch {
      // 壊れた値は無視してリセット扱いにする。
    }
  }

  if (state.count >= MAX_REQUESTS) {
    return { allowed: false };
  }

  state.count += 1;
  await kv.put(key, JSON.stringify(state), { expirationTtl: 120 });
  return { allowed: true };
}
