import type { Env } from '../_lib/types';
import { AUTHORIZATION_ENDPOINT, ISSUER, REGISTRATION_ENDPOINT, TOKEN_ENDPOINT } from '../_lib/oauth';

// OAuth 2.0 Authorization Server Metadata (RFC 8414)
export const onRequestGet: PagesFunction<Env> = async () => {
  const body = {
    issuer: ISSUER,
    authorization_endpoint: AUTHORIZATION_ENDPOINT,
    token_endpoint: TOKEN_ENDPOINT,
    registration_endpoint: REGISTRATION_ENDPOINT,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['contacts'],
  };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
};
