export interface Env {
  CONTACTS_DB: D1Database;
  CONTACT_RATE_LIMIT: KVNamespace;
  TURNSTILE_SECRET_KEY: string;
  HOBNOVA_CONTACT_API_TOKEN: string;
  // MCPのOAuth認可サーバーで、consent画面のオーナー認証に使う専用シークレット。
  // HOBNOVA_CONTACT_API_TOKEN（admin API用）とは別物。
  HOBNOVA_OAUTH_OWNER_SECRET: string;

  // publish_generated_image（MCP tool）がGitHubへPRを作るための認証情報。
  // GITHUB_APP_ID/GITHUB_APP_PRIVATE_KEY/GITHUB_APP_INSTALLATION_ID が3つとも
  // 設定されていればGitHub App（推奨・権限を絞れる）を使い、無ければGITHUB_TOKEN
  // （fine-grained PAT）にフォールバックする。いずれも未設定時はtool呼び出し時に
  // エラーを返す（起動時には落とさない）。
  GITHUB_TOKEN?: string;
  GITHUB_APP_ID?: string;
  GITHUB_APP_PRIVATE_KEY?: string;
  GITHUB_APP_INSTALLATION_ID?: string;
}

export const CONTACT_TYPES = ['advertising', 'tieup', 'product', 'review', 'other'] as const;
export type ContactType = (typeof CONTACT_TYPES)[number];

export const BUDGET_VALUES = [
  'under-50000',
  '50000-100000',
  '100000-300000',
  'over-300000',
  'undecided',
] as const;
export type BudgetValue = (typeof BUDGET_VALUES)[number];

export const CONTACT_STATUSES = ['new', 'read', 'replied', 'closed'] as const;
export type ContactStatus = (typeof CONTACT_STATUSES)[number];

export interface ContactRow {
  id: number;
  type: ContactType;
  company: string | null;
  name: string;
  website: string | null;
  email: string;
  budget: BudgetValue | null;
  message: string;
  status: ContactStatus;
  duplicate_hash: string;
  created_at: string;
}

// admin API / MCP が外部へ返す形（duplicate_hash は内部実装詳細なので含めない）。
export type ContactPublic = Omit<ContactRow, 'duplicate_hash'>;

export function toPublicContact(row: ContactRow): ContactPublic {
  const { duplicate_hash: _duplicate_hash, ...rest } = row;
  return rest;
}
