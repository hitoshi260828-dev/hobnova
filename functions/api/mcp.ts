import type { Env } from '../_lib/types';
import { CONTACT_STATUSES, toPublicContact, type ContactStatus } from '../_lib/types';
import { listContacts, getContactById, updateContactStatus } from '../_lib/db';
import { issuerFromRequest, mcpResource, protectedResourceMetadataUrl, validateAccessToken } from '../_lib/oauth';

// MCP Streamable HTTP transport（単一エンドポイント、ステートレス実装）。
// セッション管理(Mcp-Session-Id)は必須ではないため実装せず、リクエストごとに完結させる。
// 認証はOAuth 2.1（Authorization Code + PKCE、/oauth/* で発行したaccess token）。
// admin APIとは別トークン体系。ChatGPTのカスタムMCPアプリがOAuth以外を選べないための対応。
const PROTOCOL_VERSION = '2025-06-18';

function unauthorizedResponse(request: Request, errorMessage: string) {
  const origin = issuerFromRequest(request);
  return new Response(JSON.stringify(rpcError(null, -32001, errorMessage)), {
    status: 401,
    headers: {
      'content-type': 'application/json',
      // RFC 9728 Section 5.1: 401時にProtected Resource Metadataの場所を示す。
      'www-authenticate': `Bearer resource_metadata="${protectedResourceMetadataUrl(origin)}"`,
    },
  });
}

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

function rpcResult(id: unknown, result: unknown) {
  return { jsonrpc: '2.0', id: id ?? null, result };
}

function rpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

const TOOLS = [
  {
    name: 'list_contacts',
    description: 'HOBNOVAへの問い合わせ一覧を取得する。新着確認に使う。',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: CONTACT_STATUSES, description: '絞り込むステータス。省略時は全件。' },
        limit: { type: 'integer', minimum: 1, maximum: 100, description: '取得件数の上限（最大100、既定20）。' },
      },
    },
  },
  {
    name: 'get_contact',
    description: '指定したIDの問い合わせ詳細を取得する。',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'integer', description: '問い合わせID' } },
      required: ['id'],
    },
  },
  {
    name: 'update_contact_status',
    description:
      '問い合わせのステータスを更新する。list_contactsで取得しただけでは呼び出さず、ユーザーが内容を確認した場合のみ呼び出すこと。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'integer', description: '問い合わせID' },
        status: { type: 'string', enum: CONTACT_STATUSES },
      },
      required: ['id', 'status'],
    },
  },
] as const;

function toolTextResult(data: unknown, isError = false) {
  return { content: [{ type: 'text', text: JSON.stringify(data) }], isError };
}

async function callTool(env: Env, name: string, args: Record<string, unknown>) {
  switch (name) {
    case 'list_contacts': {
      const status = typeof args.status === 'string' ? args.status : undefined;
      if (status && !(CONTACT_STATUSES as readonly string[]).includes(status)) {
        return toolTextResult({ error: 'invalid_status' }, true);
      }
      const limitRaw = typeof args.limit === 'number' ? args.limit : 20;
      const limit = Math.min(Math.max(1, Math.trunc(limitRaw)), 100);
      const rows = await listContacts(env.CONTACTS_DB, {
        status: status as ContactStatus | undefined,
        limit,
      });
      return toolTextResult({ contacts: rows.map(toPublicContact) });
    }
    case 'get_contact': {
      const id = Number(args.id);
      if (!Number.isFinite(id) || id <= 0) return toolTextResult({ error: 'invalid_id' }, true);
      const contact = await getContactById(env.CONTACTS_DB, id);
      if (!contact) return toolTextResult({ error: 'not_found' }, true);
      return toolTextResult({ contact: toPublicContact(contact) });
    }
    case 'update_contact_status': {
      const id = Number(args.id);
      const status = args.status;
      if (!Number.isFinite(id) || id <= 0) return toolTextResult({ error: 'invalid_id' }, true);
      if (typeof status !== 'string' || !(CONTACT_STATUSES as readonly string[]).includes(status)) {
        return toolTextResult({ error: 'invalid_status' }, true);
      }
      const existing = await getContactById(env.CONTACTS_DB, id);
      if (!existing) return toolTextResult({ error: 'not_found' }, true);
      await updateContactStatus(env.CONTACTS_DB, id, status as ContactStatus);
      const updated = await getContactById(env.CONTACTS_DB, id);
      return toolTextResult({ contact: toPublicContact(updated!) });
    }
    default:
      return toolTextResult({ error: 'unknown_tool' }, true);
  }
}

// このエンドポイントはSSEストリームを提供しない（GETは405で「非対応」を明示するのが仕様上正しい）。
export const onRequestGet: PagesFunction<Env> = async () => {
  return new Response(null, { status: 405 });
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  const authHeader = request.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/.exec(authHeader);
  if (!match) return unauthorizedResponse(request, 'unauthorized');

  const tokenRecord = await validateAccessToken(env.CONTACTS_DB, match[1]);
  if (!tokenRecord) return unauthorizedResponse(request, 'unauthorized');
  const expectedResource = mcpResource(issuerFromRequest(request));
  if (tokenRecord.resource && tokenRecord.resource !== expectedResource) {
    return unauthorizedResponse(request, 'invalid_token_audience');
  }

  let body: JsonRpcRequest;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify(rpcError(null, -32700, 'parse_error')), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const respond = (payload: unknown, status = 200) =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });

  // 通知（idを持たないメッセージ。例: notifications/initialized）は本文なしの202を返す。
  if (body.id === undefined || body.id === null) {
    return new Response(null, { status: 202 });
  }

  switch (body.method) {
    case 'initialize':
      return respond(
        rpcResult(body.id, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: 'hobnova-contact-mcp', version: '1.0.0' },
        })
      );
    case 'tools/list':
      return respond(rpcResult(body.id, { tools: TOOLS }));
    case 'tools/call': {
      const params = body.params ?? {};
      const name = params.name as string;
      const args = (params.arguments as Record<string, unknown>) ?? {};
      if (!TOOLS.some((t) => t.name === name)) {
        return respond(rpcError(body.id, -32602, 'unknown_tool'));
      }
      const result = await callTool(env, name, args);
      return respond(rpcResult(body.id, result));
    }
    default:
      return respond(rpcError(body.id, -32601, 'method_not_found'));
  }
};
