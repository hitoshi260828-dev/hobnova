import type { ContactInput } from './validate';
import type { ContactRow, ContactStatus } from './types';

const DUPLICATE_WINDOW_HOURS = 24;

export async function findRecentDuplicate(db: D1Database, duplicateHash: string): Promise<boolean> {
  const cutoff = new Date(Date.now() - DUPLICATE_WINDOW_HOURS * 60 * 60 * 1000).toISOString();
  const row = await db
    .prepare('SELECT id FROM contacts WHERE duplicate_hash = ?1 AND created_at >= ?2 LIMIT 1')
    .bind(duplicateHash, cutoff)
    .first();
  return row !== null;
}

export async function insertContact(
  db: D1Database,
  input: ContactInput,
  duplicateHash: string
): Promise<number> {
  const createdAt = new Date().toISOString();
  const result = await db
    .prepare(
      `INSERT INTO contacts (type, company, name, website, email, budget, message, status, duplicate_hash, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'new', ?8, ?9)`
    )
    .bind(
      input.type,
      input.company,
      input.name,
      input.website,
      input.email,
      input.budget,
      input.message,
      duplicateHash,
      createdAt
    )
    .run();
  return result.meta.last_row_id as number;
}

export async function listContacts(
  db: D1Database,
  options: { status?: ContactStatus; limit: number }
): Promise<ContactRow[]> {
  const query = options.status
    ? db
        .prepare('SELECT * FROM contacts WHERE status = ?1 ORDER BY created_at DESC LIMIT ?2')
        .bind(options.status, options.limit)
    : db.prepare('SELECT * FROM contacts ORDER BY created_at DESC LIMIT ?1').bind(options.limit);

  const { results } = await query.all<ContactRow>();
  return results ?? [];
}

export async function getContactById(db: D1Database, id: number): Promise<ContactRow | null> {
  const row = await db.prepare('SELECT * FROM contacts WHERE id = ?1').bind(id).first<ContactRow>();
  return row ?? null;
}

export async function updateContactStatus(
  db: D1Database,
  id: number,
  status: ContactStatus
): Promise<boolean> {
  const result = await db
    .prepare('UPDATE contacts SET status = ?1 WHERE id = ?2')
    .bind(status, id)
    .run();
  return (result.meta.changes ?? 0) > 0;
}
