import type { Env } from '../_lib/types';
import { authorizationEndpoint, issuerFromRequest, registrationEndpoint, tokenEndpoint } from '../_lib/oauth';

// OAuth 2.0 Authorization Server Metadata (RFC 8414)
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const origin = issuerFromRequest(context.request);
  const body = {
    issuer: origin,
    authorization_endpoint: authorizationEndpoint(origin),
    token_endpoint: tokenEndpoint(origin),
    registration_endpoint: registrationEndpoint(origin),
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['contacts'],
    // RFC 9207: 認可レスポンス（成功・エラーとも）に必ず iss を付与するため true を広告する。
    // /oauth/authorize 側の実装と対で維持すること。
    authorization_response_iss_parameter_supported: true,
  };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
};
