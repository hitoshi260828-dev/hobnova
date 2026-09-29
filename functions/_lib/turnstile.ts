const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * Turnstile token をCloudflareのsiteverify APIでサーバーサイド検証する。
 * secretやtokenはログに出力しない。失敗理由（error-codes）もクライアントへは返さない。
 */
export async function verifyTurnstile(secret: string, token: string, remoteIp: string | null): Promise<boolean> {
  if (!token) return false;

  const body = new URLSearchParams();
  body.set('secret', secret);
  body.set('response', token);
  if (remoteIp) body.set('remoteip', remoteIp);

  try {
    const res = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) return false;
    const result = (await res.json()) as { success?: boolean };
    return result.success === true;
  } catch {
    // ネットワークエラー等は「未検証」として扱い、安全側（拒否）に倒す。
    return false;
  }
}
