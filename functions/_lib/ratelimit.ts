interface RateLimitState {
  count: number;
  windowStart: number;
}

/**
 * KVベースの緩いレート制限。同じ key に対して windowMs 内に maxRequests 回まで許可する。
 * KVは結果整合性のため厳密な同時実行制御はできないが、多層防御の一部として許容する。
 * 永久ブロックはしない（ウィンドウ経過で自動リセット）。
 */
export async function checkRateLimit(
  kv: KVNamespace,
  key: string,
  maxRequests: number,
  windowMs: number
): Promise<{ allowed: boolean }> {
  const now = Date.now();

  const raw = await kv.get(key);
  let state: RateLimitState = { count: 0, windowStart: now };
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as RateLimitState;
      if (now - parsed.windowStart < windowMs) {
        state = parsed;
      }
    } catch {
      // 壊れた値は無視してリセット扱いにする。
    }
  }

  if (state.count >= maxRequests) {
    return { allowed: false };
  }

  state.count += 1;
  await kv.put(key, JSON.stringify(state), { expirationTtl: Math.ceil(windowMs / 1000) + 60 });
  return { allowed: true };
}

// 問い合わせフォーム用の既定値（1分3回程度）。IPアドレス自体はKVにのみ保存し、D1には保存しない。
export function checkContactRateLimit(kv: KVNamespace, ip: string) {
  return checkRateLimit(kv, `rl:contact:${ip}`, 3, 60_000);
}

// OAuth consent画面（オーナーシークレット入力）のブルートフォース対策（1分5回程度）。
export function checkOAuthLoginRateLimit(kv: KVNamespace, ip: string) {
  return checkRateLimit(kv, `rl:oauth-login:${ip}`, 5, 60_000);
}

// Dynamic Client Registrationの乱用対策（1分10回程度）。
export function checkOAuthRegisterRateLimit(kv: KVNamespace, ip: string) {
  return checkRateLimit(kv, `rl:oauth-register:${ip}`, 10, 60_000);
}
