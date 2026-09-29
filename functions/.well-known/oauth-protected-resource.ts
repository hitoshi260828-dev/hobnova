import type { Env } from '../_lib/types';
import { ISSUER, MCP_RESOURCE } from '../_lib/oauth';

// OAuth 2.0 Protected Resource Metadata (RFC 9728)
// /api/mcp が保護対象リソースであることと、対応する認可サーバーの場所を示す。
export const onRequestGet: PagesFunction<Env> = async () => {
  const body = {
    resource: MCP_RESOURCE,
    authorization_servers: [ISSUER],
    bearer_methods_supported: ['header'],
  };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
};
