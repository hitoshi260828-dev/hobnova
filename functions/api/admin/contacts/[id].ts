import type { Env } from '../../../_lib/types';
import { CONTACT_STATUSES, toPublicContact, type ContactStatus } from '../../../_lib/types';
import { jsonResponse, errorResponse } from '../../../_lib/json';
import { isAuthorized } from '../../../_lib/auth';
import { getContactById, updateContactStatus } from '../../../_lib/db';

function parseId(raw: string | undefined): number | null {
  if (!raw) return null;
  const id = Number.parseInt(raw, 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { request, env, params } = context;

  if (!isAuthorized(request, env.HOBNOVA_CONTACT_API_TOKEN)) {
    return errorResponse('unauthorized', 401);
  }

  const id = parseId(params.id as string | undefined);
  if (id === null) return errorResponse('invalid_id', 400);

  const contact = await getContactById(env.CONTACTS_DB, id);
  if (!contact) return errorResponse('not_found', 404);

  return jsonResponse({ contact: toPublicContact(contact) });
};

export const onRequestPatch: PagesFunction<Env> = async (context) => {
  const { request, env, params } = context;

  if (!isAuthorized(request, env.HOBNOVA_CONTACT_API_TOKEN)) {
    return errorResponse('unauthorized', 401);
  }

  const id = parseId(params.id as string | undefined);
  if (id === null) return errorResponse('invalid_id', 400);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse('invalid_json', 400);
  }

  const status = (body as { status?: unknown } | null)?.status;
  if (typeof status !== 'string' || !(CONTACT_STATUSES as readonly string[]).includes(status)) {
    return errorResponse('invalid_status', 400);
  }

  const existing = await getContactById(env.CONTACTS_DB, id);
  if (!existing) return errorResponse('not_found', 404);

  await updateContactStatus(env.CONTACTS_DB, id, status as ContactStatus);
  const updated = await getContactById(env.CONTACTS_DB, id);

  return jsonResponse({ contact: toPublicContact(updated!) });
};
