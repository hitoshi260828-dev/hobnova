# 問い合わせフォーム / admin API / MCP セットアップ手順

`/contact/` フォームと、その問い合わせを ChatGPT から確認するための admin API・MCP
エンドポイントを本番で動かすために、Cloudflare ダッシュボード側で必要な設定手順をまとめる。

このプロジェクトは Astro を `output: 'static'` のまま維持し、問い合わせ機能のみ
**Cloudflare Pages Functions**（リポジトリ直下の `functions/` ディレクトリ）として追加している。
既存の静的ページ・ビルドには影響しない。

## 全体構成

```
企業 → /contact/（静的ページ） → Turnstile検証
     → POST /api/contact（Pages Functions）
         → Turnstile siteverify（サーバーサイド）
         → Rate Limit（KV, 1分3回程度）
         → duplicate hash判定（D1, 24時間以内の email+message 重複は保存しない）
         → Cloudflare D1 へ保存
     → ChatGPTが1日1回、admin API または MCP経由で新着を確認
         GET  /api/admin/contacts?status=new
         GET  /api/admin/contacts/:id
         PATCH /api/admin/contacts/:id
         または POST /api/mcp（MCP Streamable HTTP, JSON-RPC）
```

## 1. Cloudflare D1 データベースの作成

```bash
npx wrangler d1 create hobnova_contacts
```

出力される `database_id` を、リポジトリの `wrangler.toml` の
`REPLACE_WITH_ACTUAL_D1_DATABASE_ID` と置き換える。

マイグレーションを本番へ適用:

```bash
npx wrangler d1 execute hobnova_contacts --remote --file=migrations/0001_create_contacts.sql
```

さらに **Cloudflare ダッシュボード** → Pages プロジェクト（hobnova） → Settings →
Functions → D1 database bindings で、binding名 `CONTACTS_DB` を上記データベースに紐付ける
（Git連携のPagesデプロイでは、この画面での設定が本番ビルドに反映される）。

## 2. Cloudflare KV（レート制限用）の作成

```bash
npx wrangler kv namespace create CONTACT_RATE_LIMIT
```

出力される `id` を `wrangler.toml` の `REPLACE_WITH_ACTUAL_KV_NAMESPACE_ID` と置き換え、
同様にダッシュボード → Settings → Functions → KV namespace bindings で
binding名 `CONTACT_RATE_LIMIT` を紐付ける。

レート制限は「1分あたり3回程度」の緩いIPベース制限で、永久ブロックはしない
（60秒ウィンドウで自動リセット）。IPアドレス自体はKVにのみ保存し、D1（問い合わせデータ）
には保存しない。

## 3. Cloudflare Turnstile の作成

1. Cloudflareダッシュボード → Turnstile → 「Add widget」
2. ドメインに `hobnova.jp` を指定
3. Widget Mode: **Managed**
4. 作成後に表示される **Site Key** を `src/consts.ts` の `TURNSTILE_SITE_KEY` へ設定
   （Site Keyは公開情報のため、クライアント側コードに埋め込んで問題ない）
5. **Secret Key** はダッシュボード → Pages プロジェクト → Settings → Environment variables
   → 「Add secret」で `TURNSTILE_SECRET_KEY` として登録する（**Secretタイプ**で登録し、
   リポジトリには絶対にコミットしない）

## 4. admin API 用トークンの発行

admin API（`GET/PATCH /api/admin/contacts`）が使う認証トークンを生成する。例:

```bash
node -e "console.log(crypto.randomUUID() + crypto.randomUUID())"
```

生成した値を、ダッシュボード → Pages プロジェクト → Settings → Environment variables →
「Add secret」で `HOBNOVA_CONTACT_API_TOKEN` として登録する（Production/Preview両方、
必要に応じて）。このトークンは repository・クライアント側JS・ログのどこにも出力しない。

## 4-2. MCP（ChatGPT接続）用オーナーシークレットの発行

MCP（`/api/mcp`）は、ChatGPTのカスタムMCPアプリがBearer Token直接設定に対応していない
ため、OAuth 2.1（Authorization Code + PKCE）で保護している。ChatGPTが接続時にOAuth
認可画面（`/oauth/authorize`）を開くと、以下で発行する**オーナーシークレット**の入力を
求められる。これは `HOBNOVA_CONTACT_API_TOKEN` とは別物。

```bash
node -e "console.log(crypto.randomUUID() + crypto.randomUUID())"
```

生成した値を、ダッシュボード → Pages プロジェクト → Settings → Environment variables →
「Add secret」で `HOBNOVA_OAUTH_OWNER_SECRET` として登録する（Production/Preview両方）。
このシークレットは、ChatGPTからの接続を許可するたびに一度だけ入力する（発行された
access token / refresh tokenはD1にハッシュのみ保存され、以後の自動確認はそのトークンで
行われるため、毎回入力する必要はない）。

## 5. Pages Functions の反映確認

Git連携での通常デプロイ（`main` へのマージ）で、リポジトリ直下の `functions/` が
自動的にPages Functionsとして認識・デプロイされる。追加のビルド設定変更は不要。

デプロイ後、以下で疎通確認できる（`<TOKEN>` は上記で設定した値）:

```bash
curl -s "https://hobnova.jp/api/admin/contacts?limit=1" \
  -H "Authorization: Bearer <TOKEN>"
# => {"contacts":[]}
```

## 6. ChatGPT / MCP 側の接続設定

### admin APIを直接使う場合

- Base URL: `https://hobnova.jp/api/admin/contacts`
- 認証: `Authorization: Bearer <HOBNOVA_CONTACT_API_TOKEN>`
- `GET /api/admin/contacts?status=new&limit=20` で新着一覧
- `GET /api/admin/contacts/:id` で詳細
- `PATCH /api/admin/contacts/:id`（body: `{"status":"read"}`）でステータス更新

### MCP（Streamable HTTP、OAuth 2.1）を使う場合

ChatGPTの「カスタムMCPアプリを作成」画面で、以下のように設定する:

- MCPサーバーURL: `https://hobnova.jp/api/mcp`
- 認証方式: **OAuth**
- Client ID / Client Secretの入力欄が出た場合は空欄でよい（Dynamic Client Registration
  で自動登録される。当サーバーはpublic client方式で `client_secret` を発行しない）

接続時、ブラウザで `https://hobnova.jp/oauth/authorize` が開き、上記4-2で発行した
**オーナーシークレット**の入力を求められる。正しく入力すると、ChatGPT側に
access token / refresh token が発行され、以後はこのトークンで自動接続される。

技術詳細:
- Protected Resource Metadata: `GET /.well-known/oauth-protected-resource` (RFC 9728)
- Authorization Server Metadata: `GET /.well-known/oauth-authorization-server` (RFC 8414)
- Dynamic Client Registration: `POST /oauth/register` (RFC 7591)
- Authorization endpoint: `GET/POST /oauth/authorize`（PKCE S256必須、state必須）
- Token endpoint: `POST /oauth/token`（`authorization_code` / `refresh_token`）
- access tokenの有効期限は1時間、refresh tokenは90日（使用の都度ローテーション）
- セッション管理（`Mcp-Session-Id`）は未実装（ステートレス。MCP仕様上は任意項目）
- 提供ツール: `list_contacts`（引数: `status`, `limit`）、`get_contact`（引数: `id`）、
  `update_contact_status`（引数: `id`, `status`）
- ChatGPT側の「1日1回確認」スケジュールはユーザー側で設定済みのため、Cloudflare側に
  cron/schedule は追加していない。
- admin API（`HOBNOVA_CONTACT_API_TOKEN`によるBearer認証）とMCP（OAuth）は別トークン
  体系。MCPのaccess tokenはadmin APIへは使えず、その逆も同様。

**重要**: `list_contacts` で取得しただけでは `status` は自動的に `read` へ変わらない。
ユーザーが内容を確認した後、必要に応じて `update_contact_status` を呼び出すこと。

## 7. ローカルでの動作確認方法

```bash
npm run build
npx wrangler d1 execute hobnova_contacts --local --file=migrations/0001_create_contacts.sql
npx wrangler d1 execute hobnova_contacts --local --file=migrations/0002_create_oauth_tables.sql

# .dev.vars（.gitignore済み・本番Secretとは別の値を使う）
cat <<'EOF' > .dev.vars
TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA
HOBNOVA_CONTACT_API_TOKEN=local-test-token
HOBNOVA_OAUTH_OWNER_SECRET=local-owner-secret
EOF

npx wrangler pages dev dist --port 8788 --local
```

`1x0000000000000000000000000000000AA` はCloudflare公式のTurnstileテスト用secret key
（常に成功）。本番のSecret Keyとは異なり、ローカル検証専用。

## 8. 本番デプロイ後の確認チェックリスト

- [ ] `https://hobnova.jp/contact/` が表示され、Turnstileウィジェットが描画される
- [ ] テスト送信 → D1にレコードが作成される（`wrangler d1 execute hobnova_contacts --remote --command "SELECT * FROM contacts"`）
- [ ] admin API に正しいBearer Tokenでアクセスでき、Tokenなし/誤りでは401になる
- [ ] 既存記事・Amazonアフィリエイト・AdSense・sitemap・robots.txtが変わらず動作している
