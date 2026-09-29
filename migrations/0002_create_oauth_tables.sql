-- MCPをChatGPT Remote MCPからOAuth 2.1(Authorization Code + PKCE)で
-- 接続できるようにするための、最小限の自前OAuth認可サーバー用テーブル。
-- 既存の hobnova_contacts D1データベースに追加する（新規D1は作成しない）。

CREATE TABLE IF NOT EXISTS oauth_clients (
  client_id TEXT PRIMARY KEY,
  client_name TEXT,
  redirect_uris TEXT NOT NULL,              -- JSON配列（文字列）
  token_endpoint_auth_method TEXT NOT NULL DEFAULT 'none',
  created_at TEXT NOT NULL
);

-- 認可コード（短命・使い捨て）。生のcodeはDBに残さずハッシュのみ保存する。
CREATE TABLE IF NOT EXISTS oauth_codes (
  code_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  code_challenge_method TEXT NOT NULL,
  resource TEXT,
  scope TEXT,
  used INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_oauth_codes_expires_at ON oauth_codes (expires_at);

-- access token / refresh token。生の値はDBに残さずハッシュのみ保存する。
CREATE TABLE IF NOT EXISTS oauth_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id TEXT NOT NULL,
  access_token_hash TEXT NOT NULL,
  refresh_token_hash TEXT,
  resource TEXT,
  scope TEXT,
  revoked INTEGER NOT NULL DEFAULT 0,
  access_expires_at TEXT NOT NULL,
  refresh_expires_at TEXT,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_oauth_tokens_access_hash ON oauth_tokens (access_token_hash);
CREATE UNIQUE INDEX IF NOT EXISTS idx_oauth_tokens_refresh_hash ON oauth_tokens (refresh_token_hash);
