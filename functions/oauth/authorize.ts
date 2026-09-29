import type { Env } from '../_lib/types';
import { timingSafeEqual } from '../_lib/auth';
import { checkOAuthLoginRateLimit } from '../_lib/ratelimit';
import { createAuthCode, escapeHtml, getClient, isValidRedirectUri, MCP_RESOURCE } from '../_lib/oauth';

interface AuthorizeParams {
  responseType: string | null;
  clientId: string | null;
  redirectUri: string | null;
  state: string | null;
  codeChallenge: string | null;
  codeChallengeMethod: string | null;
  resource: string | null;
  scope: string | null;
}

function parseParams(url: URL): AuthorizeParams {
  return {
    responseType: url.searchParams.get('response_type'),
    clientId: url.searchParams.get('client_id'),
    redirectUri: url.searchParams.get('redirect_uri'),
    state: url.searchParams.get('state'),
    codeChallenge: url.searchParams.get('code_challenge'),
    codeChallengeMethod: url.searchParams.get('code_challenge_method'),
    resource: url.searchParams.get('resource'),
    scope: url.searchParams.get('scope'),
  };
}

function htmlResponse(html: string, status = 200) {
  return new Response(html, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}

function renderLoginForm(params: AuthorizeParams, clientName: string | null, errorMessage?: string) {
  const hidden = (name: string, value: string | null) =>
    value !== null ? `<input type="hidden" name="${name}" value="${escapeHtml(value)}" />` : '';

  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>HOBNOVA MCP 連携の承認</title>
<style>
  body { font-family: system-ui, sans-serif; background: #f5f7fa; color: #1f2937; display: flex; min-height: 100vh; align-items: center; justify-content: center; margin: 0; }
  .card { background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 2rem; max-width: 360px; width: 100%; }
  h1 { font-size: 1.1rem; margin: 0 0 0.5rem; color: #111827; }
  p { font-size: 0.875rem; color: #374151; line-height: 1.6; }
  input[type="password"] { width: 100%; box-sizing: border-box; padding: 0.6rem 0.75rem; border: 1px solid #e5e7eb; border-radius: 6px; margin-top: 0.5rem; }
  button { width: 100%; margin-top: 1.25rem; padding: 0.7rem; border: none; border-radius: 6px; background: #111827; color: #fff; font-weight: bold; cursor: pointer; }
  .error { color: #b91c1c; font-size: 0.8rem; margin-top: 0.75rem; }
</style>
</head>
<body>
  <div class="card">
    <h1>HOBNOVA 問い合わせMCPへの接続を許可しますか？</h1>
    <p>接続元: <strong>${escapeHtml(clientName ?? '不明なアプリケーション')}</strong><br />
    許可すると、問い合わせデータの閲覧・ステータス更新が可能になります。</p>
    <form method="POST" action="/oauth/authorize">
      ${hidden('response_type', params.responseType)}
      ${hidden('client_id', params.clientId)}
      ${hidden('redirect_uri', params.redirectUri)}
      ${hidden('state', params.state)}
      ${hidden('code_challenge', params.codeChallenge)}
      ${hidden('code_challenge_method', params.codeChallengeMethod)}
      ${hidden('resource', params.resource)}
      ${hidden('scope', params.scope)}
      <label for="owner_secret" style="font-size:0.8rem;font-weight:600;">オーナーシークレット</label>
      <input type="password" id="owner_secret" name="owner_secret" required autofocus />
      <button type="submit">許可する</button>
      ${errorMessage ? `<p class="error">${escapeHtml(errorMessage)}</p>` : ''}
    </form>
  </div>
</body>
</html>`;
}

function redirectWithError(redirectUri: string, state: string | null, error: string, description?: string): Response {
  const url = new URL(redirectUri);
  url.searchParams.set('error', error);
  if (description) url.searchParams.set('error_description', description);
  if (state) url.searchParams.set('state', state);
  return new Response(null, { status: 302, headers: { location: url.toString() } });
}

async function validateAndGetClient(env: Env, params: AuthorizeParams) {
  if (!params.clientId || !params.redirectUri) {
    return { error: htmlResponse('invalid_request: client_id and redirect_uri are required', 400) };
  }
  const client = await getClient(env.CONTACTS_DB, params.clientId);
  if (!client) {
    return { error: htmlResponse('invalid_client', 400) };
  }
  if (!isValidRedirectUri(client, params.redirectUri)) {
    return { error: htmlResponse('invalid_request: redirect_uri not registered for this client', 400) };
  }
  return { client };
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  const url = new URL(request.url);
  const params = parseParams(url);

  const { client, error } = await validateAndGetClient(env, params);
  if (error) return error;

  // client_id/redirect_uriの検証後に判明するエラーは、以後 redirect_uri 側へ返す。
  if (params.responseType !== 'code') {
    return redirectWithError(params.redirectUri!, params.state, 'unsupported_response_type');
  }
  if (!params.codeChallenge || params.codeChallengeMethod !== 'S256') {
    return redirectWithError(params.redirectUri!, params.state, 'invalid_request', 'PKCE (S256) is required');
  }
  if (!params.state) {
    return redirectWithError(params.redirectUri!, params.state, 'invalid_request', 'state is required');
  }
  if (params.resource && params.resource !== MCP_RESOURCE) {
    return redirectWithError(params.redirectUri!, params.state, 'invalid_target');
  }

  return htmlResponse(renderLoginForm(params, client!.client_name));
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const rateLimit = await checkOAuthLoginRateLimit(env.CONTACT_RATE_LIMIT, ip);
  if (!rateLimit.allowed) {
    return new Response('Too many requests', { status: 429 });
  }

  const form = await request.formData();
  const params: AuthorizeParams = {
    responseType: (form.get('response_type') as string) ?? null,
    clientId: (form.get('client_id') as string) ?? null,
    redirectUri: (form.get('redirect_uri') as string) ?? null,
    state: (form.get('state') as string) ?? null,
    codeChallenge: (form.get('code_challenge') as string) ?? null,
    codeChallengeMethod: (form.get('code_challenge_method') as string) ?? null,
    resource: (form.get('resource') as string) ?? null,
    scope: (form.get('scope') as string) ?? null,
  };
  const ownerSecret = (form.get('owner_secret') as string) ?? '';

  const { client, error } = await validateAndGetClient(env, params);
  if (error) return error;

  if (
    params.responseType !== 'code' ||
    !params.codeChallenge ||
    params.codeChallengeMethod !== 'S256' ||
    !params.state
  ) {
    return redirectWithError(params.redirectUri!, params.state, 'invalid_request');
  }

  if (!env.HOBNOVA_OAUTH_OWNER_SECRET || !timingSafeEqual(ownerSecret, env.HOBNOVA_OAUTH_OWNER_SECRET)) {
    return htmlResponse(renderLoginForm(params, client!.client_name, 'シークレットが正しくありません。'), 401);
  }

  const code = await createAuthCode(env.CONTACTS_DB, {
    clientId: client!.client_id,
    redirectUri: params.redirectUri!,
    codeChallenge: params.codeChallenge,
    codeChallengeMethod: params.codeChallengeMethod,
    resource: params.resource,
    scope: params.scope,
  });

  const redirectUrl = new URL(params.redirectUri!);
  redirectUrl.searchParams.set('code', code);
  redirectUrl.searchParams.set('state', params.state);
  return new Response(null, { status: 302, headers: { location: redirectUrl.toString() } });
};
