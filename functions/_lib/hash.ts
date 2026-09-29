export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * email + message を正規化した上でSHA-256ハッシュ化する（重複問い合わせ判定用）。
 * 元のemail/messageはこの関数の呼び出し元でログへ出力しないこと。
 */
export async function computeDuplicateHash(email: string, message: string): Promise<string> {
  const normalizedEmail = email.trim().toLowerCase();
  const normalizedMessage = message.trim().replace(/\s+/g, ' ');
  return sha256Hex(`${normalizedEmail}\u0000${normalizedMessage}`);
}

/**
 * OAuthのaccess token / refresh token / authorization code に使う、
 * 十分なエントロピー（256bit）を持つランダムトークンを生成する。
 * 生の値はURLセーフなbase64で返し、DBにはこの値のハッシュのみを保存する。
 */
export function generateRandomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
