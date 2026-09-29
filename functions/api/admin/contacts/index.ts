import type { Env } from '../../../_lib/types';
import { CONTACT_STATUSES, toPublicContact, type ContactStatus } from '../../../_lib/types';
import { jsonResponse, errorResponse } from '../../../_lib/json';
import { isAuthorized } from '../../../_lib/auth';
import { listContacts } from '../../../_lib/db';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  if (!isAuthorized(request, env.HOBNOVA_CONTACT_API_TOKEN)) {
    return errorResponse('unauthorized', 401);
  }

  const url = new URL(request.url);
  const statusParam = url.searchParams.get('status');
  let status: ContactStatus | undefined;
  if (statusParam) {
    if (!(CONTACT_STATUSES as readonly string[]).includes(statusParam)) {
      return errorResponse('invalid_status', 400);
    }
    status = statusParam as ContactStatus;
  }

  const limitParam = url.searchParams.get('limit');
  let limit = DEFAULT_LIMIT;
  if (limitParam) {
    const parsed = Number.parseInt(limitParam, 10);
    if (!Number.isFinite(parsed) || parsed < 1) {
      return errorResponse('invalid_limit', 400);
    }
    limit = Math.min(parsed, MAX_LIMIT);
  }

  const rows = await listContacts(env.CONTACTS_DB, { status, limit });
  return jsonResponse({ contacts: rows.map(toPublicContact) });
};
