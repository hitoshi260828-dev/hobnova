import type { Env } from '../_lib/types';
import { jsonResponse, errorResponse } from '../_lib/json';
import { consumeAuthCode, getClient, isValidRedirectUri, rotateRefreshToken, issueTokenPair, verifyPkce } from '../_lib/oauth';

// トークンエンドポイントは秘密情報（authorization code / refresh token）を扱うため、
// リクエスト内容・発行したトークンはログへ一切出力しない。
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/x-www-form-urlencoded')) {
    return errorResponse('invalid_request', 400, { error_description: 'Content-Type must be application/x-www-form-urlencoded' });
  }

  const form = await request.formData();
  const grantType = form.get('grant_type');

  if (grantType === 'authorization_code') {
    const code = form.get('code');
    const redirectUri = form.get('redirect_uri');
    const clientId = form.get('client_id');
    const codeVerifier = form.get('code_verifier');

    if (
      typeof code !== 'string' ||
      typeof redirectUri !== 'string' ||
      typeof clientId !== 'string' ||
      typeof codeVerifier !== 'string'
    ) {
      return errorResponse('invalid_request', 400);
    }

    const client = await getClient(env.CONTACTS_DB, clientId);
    if (!client) return errorResponse('invalid_client', 400);

    const record = await consumeAuthCode(env.CONTACTS_DB, code);
    if (!record) return errorResponse('invalid_grant', 400, { error_description: 'code is invalid, expired, or already used' });

    if (record.client_id !== clientId) return errorResponse('invalid_grant', 400);
    if (record.redirect_uri !== redirectUri || !isValidRedirectUri(client, redirectUri)) {
      return errorResponse('invalid_grant', 400, { error_description: 'redirect_uri mismatch' });
    }

    const pkceOk = await verifyPkce(codeVerifier, record.code_challenge);
    if (!pkceOk) return errorResponse('invalid_grant', 400, { error_description: 'code_verifier mismatch' });

    const tokens = await issueTokenPair(env.CONTACTS_DB, client.client_id, record.resource, record.scope);
    return jsonResponse(tokens);
  }

  if (grantType === 'refresh_token') {
    const refreshToken = form.get('refresh_token');
    const clientId = form.get('client_id');

    if (typeof refreshToken !== 'string' || typeof clientId !== 'string') {
      return errorResponse('invalid_request', 400);
    }

    const client = await getClient(env.CONTACTS_DB, clientId);
    if (!client) return errorResponse('invalid_client', 400);

    const tokens = await rotateRefreshToken(env.CONTACTS_DB, clientId, refreshToken);
    if (!tokens) return errorResponse('invalid_grant', 400, { error_description: 'refresh_token is invalid, expired, or revoked' });

    return jsonResponse(tokens);
  }

  return errorResponse('unsupported_grant_type', 400);
};
