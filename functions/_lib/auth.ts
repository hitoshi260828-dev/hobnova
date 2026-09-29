/**
 * タイミング攻撃を避けるための定数時間比較。
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const aBytes = enc.encode(a);
  const bBytes = enc.encode(b);
  if (aBytes.length !== bBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) {
    diff |= aBytes[i] ^ bBytes[i];
  }
  return diff === 0;
}

/**
 * admin API向けのBearer Token検証。トークンそのものはログに出さない。
 */
export function isAuthorized(request: Request, expectedToken: string): boolean {
  if (!expectedToken) return false;
  const header = request.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/.exec(header);
  if (!match) return false;
  return timingSafeEqual(match[1], expectedToken);
}
