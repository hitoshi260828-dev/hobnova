/**
 * email + message を正規化した上でSHA-256ハッシュ化する（重複問い合わせ判定用）。
 * 元のemail/messageはこの関数の呼び出し元でログへ出力しないこと。
 */
export async function computeDuplicateHash(email: string, message: string): Promise<string> {
  const normalizedEmail = email.trim().toLowerCase();
  const normalizedMessage = message.trim().replace(/\s+/g, ' ');
  const input = `${normalizedEmail}\u0000${normalizedMessage}`;

  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
