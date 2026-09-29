import { generateRandomToken, sha256Hex } from './hash';

export const ISSUER = 'https://hobnova.jp';
export const MCP_RESOURCE = 'https://hobnova.jp/api/mcp';
export const AUTHORIZATION_ENDPOINT = `${ISSUER}/oauth/authorize`;
export const TOKEN_ENDPOINT = `${ISSUER}/oauth/token`;
export const REGISTRATION_ENDPOINT = `${ISSUER}/oauth/register`;
export const PROTECTED_RESOURCE_METADATA_URL = `${ISSUER}/.well-known/oauth-protected-resource`;

const AUTH_CODE_TTL_MS = 60_000; // 60秒（短命・使い捨て）
const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000; // 1時間
const REFRESH_TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90日

export interface OAuthClient {
  client_id: string;
  client_name: string | null;
  redirect_uris: string[];
  token_endpoint_auth_method: string;
}

function isLoopbackHost(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
}

/**
 * redirect_uriの厳密な検証。登録済みURIと完全一致することを要求する。
 * 例外として、RFC 8252 Section 7.3（ネイティブアプリのループバックリダイレクト）に従い、
 * ホストがループバックアドレスの場合はポート番号の違いのみ許容する。
 */
export function isValidRedirectUri(client: OAuthClient, candidate: string): boolean {
  if (client.redirect_uris.includes(candidate)) return true;

  try {
    const candidateUrl = new URL(candidate);
    if (!isLoopbackHost(candidateUrl.hostname)) return false;

    return client.redirect_uris.some((registered) => {
      try {
        const registeredUrl = new URL(registered);
        return (
          isLoopbackHost(registeredUrl.hostname) &&
          registeredUrl.protocol === candidateUrl.protocol &&
          registeredUrl.hostname === candidateUrl.hostname &&
          registeredUrl.pathname === candidateUrl.pathname
        );
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

export async function createClient(
  db: D1Database,
  clientName: string | null,
  redirectUris: string[]
): Promise<OAuthClient> {
  const clientId = generateRandomToken();
  const createdAt = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO oauth_clients (client_id, client_name, redirect_uris, token_endpoint_auth_method, created_at)
       VALUES (?1, ?2, ?3, 'none', ?4)`
    )
    .bind(clientId, clientName, JSON.stringify(redirectUris), createdAt)
    .run();

  return { client_id: clientId, client_name: clientName, redirect_uris: redirectUris, token_endpoint_auth_method: 'none' };
}

export async function getClient(db: D1Database, clientId: string): Promise<OAuthClient | null> {
  const row = await db
    .prepare('SELECT client_id, client_name, redirect_uris, token_endpoint_auth_method FROM oauth_clients WHERE client_id = ?1')
    .bind(clientId)
    .first<{ client_id: string; client_name: string | null; redirect_uris: string; token_endpoint_auth_method: string }>();
  if (!row) return null;

  let redirectUris: string[] = [];
  try {
    redirectUris = JSON.parse(row.redirect_uris);
  } catch {
    redirectUris = [];
  }

  return {
    client_id: row.client_id,
    client_name: row.client_name,
    redirect_uris: redirectUris,
    token_endpoint_auth_method: row.token_endpoint_auth_method,
  };
}

export interface CreateAuthCodeInput {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  resource: string | null;
  scope: string | null;
}

export async function createAuthCode(db: D1Database, input: CreateAuthCodeInput): Promise<string> {
  const code = generateRandomToken();
  const codeHash = await sha256Hex(code);
  const now = Date.now();
  const expiresAt = new Date(now + AUTH_CODE_TTL_MS).toISOString();

  await db
    .prepare(
      `INSERT INTO oauth_codes
        (code_hash, client_id, redirect_uri, code_challenge, code_challenge_method, resource, scope, used, expires_at, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, ?8, ?9)`
    )
    .bind(
      codeHash,
      input.clientId,
      input.redirectUri,
      input.codeChallenge,
      input.codeChallengeMethod,
      input.resource,
      input.scope,
      expiresAt,
      new Date(now).toISOString()
    )
    .run();

  return code;
}

interface AuthCodeRecord {
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: string;
  resource: string | null;
  scope: string | null;
}

/**
 * 認可コードを検証して消費する（使い捨て・単発利用）。
 * 有効な場合のみレコードを返し、同時に used=1 へ更新して再利用を防ぐ。
 */
export async function consumeAuthCode(db: D1Database, rawCode: string): Promise<AuthCodeRecord | null> {
  const codeHash = await sha256Hex(rawCode);
  const nowIso = new Date().toISOString();

  const row = await db
    .prepare(
      `SELECT client_id, redirect_uri, code_challenge, code_challenge_method, resource, scope
       FROM oauth_codes WHERE code_hash = ?1 AND used = 0 AND expires_at > ?2`
    )
    .bind(codeHash, nowIso)
    .first<AuthCodeRecord>();
  if (!row) return null;

  const result = await db
    .prepare('UPDATE oauth_codes SET used = 1 WHERE code_hash = ?1 AND used = 0')
    .bind(codeHash)
    .run();
  if ((result.meta.changes ?? 0) === 0) return null; // 競合で他リクエストが先に消費した

  return row;
}

/**
 * PKCE(S256)のcode_verifierを検証する。
 */
export async function verifyPkce(codeVerifier: string, codeChallenge: string): Promise<boolean> {
  const data = new TextEncoder().encode(codeVerifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(digest);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const computed = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return computed === codeChallenge;
}

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  token_type: 'Bearer';
  expires_in: number;
}

export async function issueTokenPair(
  db: D1Database,
  clientId: string,
  resource: string | null,
  scope: string | null
): Promise<TokenPair> {
  const accessToken = generateRandomToken();
  const refreshToken = generateRandomToken();
  const accessHash = await sha256Hex(accessToken);
  const refreshHash = await sha256Hex(refreshToken);
  const now = Date.now();
  const accessExpiresAt = new Date(now + ACCESS_TOKEN_TTL_MS).toISOString();
  const refreshExpiresAt = new Date(now + REFRESH_TOKEN_TTL_MS).toISOString();

  await db
    .prepare(
      `INSERT INTO oauth_tokens
        (client_id, access_token_hash, refresh_token_hash, resource, scope, revoked, access_expires_at, refresh_expires_at, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, ?7, ?8)`
    )
    .bind(clientId, accessHash, refreshHash, resource, scope, accessExpiresAt, refreshExpiresAt, new Date(now).toISOString())
    .run();

  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: 'Bearer',
    expires_in: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
  };
}

interface TokenRecord {
  id: number;
  client_id: string;
  resource: string | null;
  scope: string | null;
}

export async function validateAccessToken(db: D1Database, rawAccessToken: string): Promise<TokenRecord | null> {
  const hash = await sha256Hex(rawAccessToken);
  const nowIso = new Date().toISOString();
  const row = await db
    .prepare(
      `SELECT id, client_id, resource, scope FROM oauth_tokens
       WHERE access_token_hash = ?1 AND revoked = 0 AND access_expires_at > ?2`
    )
    .bind(hash, nowIso)
    .first<TokenRecord>();
  return row ?? null;
}

/**
 * リフレッシュトークンをローテーションする（OAuth 2.1の要求により、public clientでは使用の都度再発行し旧トークンを失効させる）。
 */
export async function rotateRefreshToken(
  db: D1Database,
  clientId: string,
  rawRefreshToken: string
): Promise<TokenPair | null> {
  const hash = await sha256Hex(rawRefreshToken);
  const nowIso = new Date().toISOString();

  const row = await db
    .prepare(
      `SELECT id, resource, scope FROM oauth_tokens
       WHERE refresh_token_hash = ?1 AND client_id = ?2 AND revoked = 0 AND refresh_expires_at > ?3`
    )
    .bind(hash, clientId, nowIso)
    .first<{ id: number; resource: string | null; scope: string | null }>();
  if (!row) return null;

  await db.prepare('UPDATE oauth_tokens SET revoked = 1 WHERE id = ?1').bind(row.id).run();

  return issueTokenPair(db, clientId, row.resource, row.scope);
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
