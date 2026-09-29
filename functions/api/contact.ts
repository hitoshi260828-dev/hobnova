import type { Env } from '../_lib/types';
import { jsonResponse, errorResponse } from '../_lib/json';
import { validateContactInput } from '../_lib/validate';
import { verifyTurnstile } from '../_lib/turnstile';
import { checkRateLimit } from '../_lib/ratelimit';
import { computeDuplicateHash } from '../_lib/hash';
import { findRecentDuplicate, insertContact } from '../_lib/db';

const MAX_BODY_BYTES = 20_000; // 問い合わせ本文の上限(5000文字)に十分なマージンを持たせたサイズ上限
const HONEYPOT_FIELD = 'website_confirm';

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    return errorResponse('unsupported_content_type', 415);
  }

  const rawBody = await request.text();
  if (rawBody.length > MAX_BODY_BYTES) {
    return errorResponse('payload_too_large', 413);
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return errorResponse('invalid_json', 400);
  }

  const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;

  // Honeypot: botが埋めていた場合は保存せず、通常の成功レスポンスを返して判定理由を悟らせない。
  if (typeof b[HONEYPOT_FIELD] === 'string' && b[HONEYPOT_FIELD].trim().length > 0) {
    return jsonResponse({ success: true });
  }

  const validation = validateContactInput(b);
  if (!validation.valid || !validation.data) {
    return errorResponse('validation_error', 400, { fields: validation.errors });
  }

  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';

  const rateLimit = await checkRateLimit(env.CONTACT_RATE_LIMIT, ip);
  if (!rateLimit.allowed) {
    return errorResponse('Too many requests', 429);
  }

  const turnstileToken = typeof b.turnstileToken === 'string' ? b.turnstileToken : '';
  const turnstileOk = await verifyTurnstile(env.TURNSTILE_SECRET_KEY, turnstileToken, ip);
  if (!turnstileOk) {
    return errorResponse('turnstile_failed', 400);
  }

  const duplicateHash = await computeDuplicateHash(validation.data.email, validation.data.message);
  const isDuplicate = await findRecentDuplicate(env.CONTACTS_DB, duplicateHash);
  if (isDuplicate) {
    // 重複は新規保存しないが、送信者には成功と同じ体験を返す（二重送信の混乱を避けるため）。
    return jsonResponse({ success: true });
  }

  await insertContact(env.CONTACTS_DB, validation.data, duplicateHash);

  return jsonResponse({ success: true });
};

export const onRequestGet: PagesFunction<Env> = async () => {
  return errorResponse('method_not_allowed', 405);
};
