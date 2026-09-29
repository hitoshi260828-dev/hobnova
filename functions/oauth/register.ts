import type { Env } from '../_lib/types';
import { jsonResponse, errorResponse } from '../_lib/json';
import { checkOAuthRegisterRateLimit } from '../_lib/ratelimit';
import { createClient } from '../_lib/oauth';

const MAX_BODY_BYTES = 20_000;

// OAuth 2.0 Dynamic Client Registration Protocol (RFC 7591)。
// 登録だけではデータへアクセスできない（実際のトークン発行には /oauth/authorize で
// オーナーシークレットによる同意が別途必要）ため、登録自体はオープンにしている。
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const rateLimit = await checkOAuthRegisterRateLimit(env.CONTACT_RATE_LIMIT, ip);
  if (!rateLimit.allowed) {
    return errorResponse('Too many requests', 429);
  }

  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    return errorResponse('invalid_client_metadata', 400, { error_description: 'Content-Type must be application/json' });
  }

  const rawBody = await request.text();
  if (rawBody.length > MAX_BODY_BYTES) {
    return errorResponse('invalid_client_metadata', 413);
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return errorResponse('invalid_client_metadata', 400);
  }

  const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const redirectUrisRaw = b.redirect_uris;

  if (!Array.isArray(redirectUrisRaw) || redirectUrisRaw.length === 0) {
    return errorResponse('invalid_redirect_uri', 400, { error_description: 'redirect_uris is required' });
  }

  const redirectUris: string[] = [];
  for (const uri of redirectUrisRaw) {
    if (typeof uri !== 'string') {
      return errorResponse('invalid_redirect_uri', 400);
    }
    try {
      const parsed = new URL(uri);
      if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
        return errorResponse('invalid_redirect_uri', 400, {
          error_description: 'redirect_uri must use https, or be a loopback address',
        });
      }
    } catch {
      return errorResponse('invalid_redirect_uri', 400);
    }
    redirectUris.push(uri);
  }

  const clientName = typeof b.client_name === 'string' ? b.client_name.slice(0, 200) : null;

  const client = await createClient(env.CONTACTS_DB, clientName, redirectUris);

  return jsonResponse(
    {
      client_id: client.client_id,
      client_name: client.client_name,
      redirect_uris: client.redirect_uris,
      token_endpoint_auth_method: client.token_endpoint_auth_method,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    },
    201
  );
};
