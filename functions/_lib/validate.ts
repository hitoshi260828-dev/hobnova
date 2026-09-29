import { BUDGET_VALUES, CONTACT_TYPES, type BudgetValue, type ContactType } from './types';

export interface ContactInput {
  type: ContactType;
  company: string | null;
  name: string;
  website: string | null;
  email: string;
  budget: BudgetValue | null;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: Record<string, string>;
  data?: ContactInput;
}

// 簡易だが実用的なemail形式チェック（RFC完全準拠は狙わず、明らかな不正のみ弾く）。
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function validateWebsite(value: unknown): { ok: boolean; normalized: string | null } {
  if (value === undefined || value === null || value === '') return { ok: true, normalized: null };
  if (typeof value !== 'string') return { ok: false, normalized: null };
  const trimmed = value.trim();
  if (!/^https?:\/\//i.test(trimmed)) return { ok: false, normalized: null };
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false, normalized: null };
    return { ok: true, normalized: url.toString() };
  } catch {
    return { ok: false, normalized: null };
  }
}

/**
 * POST /api/contact のリクエストボディをサーバー側で検証する。
 * フロント側のバリデーションは信頼せず、ここで全項目を再チェックする。
 */
export function validateContactInput(body: unknown): ValidationResult {
  const errors: Record<string, string> = {};

  if (typeof body !== 'object' || body === null) {
    return { valid: false, errors: { _: 'invalid_body' } };
  }
  const b = body as Record<string, unknown>;

  if (!isNonEmptyString(b.type) || !(CONTACT_TYPES as readonly string[]).includes(b.type as string)) {
    errors.type = 'invalid_type';
  }

  const company = typeof b.company === 'string' ? b.company.trim() : '';
  if (company.length > 150) errors.company = 'too_long';

  const name = typeof b.name === 'string' ? b.name.trim() : '';
  if (name.length < 1 || name.length > 100) errors.name = 'invalid_length';

  const websiteCheck = validateWebsite(b.website);
  if (!websiteCheck.ok) errors.website = 'invalid_url';

  const email = typeof b.email === 'string' ? b.email.trim() : '';
  if (!EMAIL_PATTERN.test(email) || email.length > 254) errors.email = 'invalid_email';

  let budget: BudgetValue | null = null;
  if (b.budget !== undefined && b.budget !== null && b.budget !== '') {
    if (typeof b.budget === 'string' && (BUDGET_VALUES as readonly string[]).includes(b.budget)) {
      budget = b.budget as BudgetValue;
    } else {
      errors.budget = 'invalid_budget';
    }
  }

  const message = typeof b.message === 'string' ? b.message.trim() : '';
  if (message.length < 20 || message.length > 5000) errors.message = 'invalid_length';

  if (b.privacyAccepted !== true) errors.privacyAccepted = 'required';

  if (Object.keys(errors).length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    errors: {},
    data: {
      type: b.type as ContactType,
      company: company.length > 0 ? company : null,
      name,
      website: websiteCheck.normalized,
      email,
      budget,
      message,
    },
  };
}
