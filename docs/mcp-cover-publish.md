# MCP経由のアイキャッチ取り込み（publish_generated_image）

ChatGPTで生成・選択した画像を、ローカルDownloads経由やClaude Codeへのパス受け渡しを挟まず、
ChatGPTから直接HOBNOVAへ反映するための仕組み。既存のMCPサーバー（`functions/api/mcp.ts`、
`list_contacts` / `get_contact` / `update_contact_status` を提供しているもの）へ、新しいtool
`publish_generated_image` を追加する形で実装した。新しいHTTPルートは追加していない
（既存の `POST /api/mcp` エンドポイント・既存のOAuth 2.1認証をそのまま再利用する）。

## 全体フロー

```
ユーザー「この画像をこの記事のアイキャッチに採用して」
  → ChatGPT（MCP経由でpublish_generated_imageを呼ぶ。添付画像はbase64で自動的に埋め込まれる）
  → POST /api/mcp（既存のOAuth Bearer tokenで認証）
  → functions/_lib/cover-publish.ts
      → 入力検証（article_path / 画像MIME・サイズ・マジックバイト）
      → 既存cover確認（あればreplace=true必須）
      → GitHub Git Data APIで新規ブランチ・blob・tree・commit・PR作成
  → ChatGPTへPR番号・URL等を構造化レスポンスで返す
```

mainへの直接commit・自動mergeは一切行わない。常にPull Requestとして提案するのみ。

## 新しいtool: `publish_generated_image`

入力（MCP `tools/call` の `arguments`）:

```json
{
  "article_path": "src/content/articles/laptop-buying-guide.md",
  "image": { "data": "<base64 or data URL>", "mime_type": "image/png" },
  "alt": "任意の代替テキスト",
  "replace": false,
  "dry_run": false
}
```

- `article_path`: `src/content/articles|data-lab|tools/` 配下のフラットな `.md`/`.mdx` のみ許可。
  path traversal・絶対パス・サブディレクトリは拒否する（`functions/_lib/image-validate.ts`）。
- `image.data`: base64文字列、または `data:image/png;base64,...` 形式のdata URL。
  ChatGPT側で「添付画像をツールへ送る」設定を有効にしている場合、会話内の画像がここへ
  自動的に入る想定（ユーザーが手動でbase64を扱う必要はない）。
- `image.mime_type`: `image/png` / `image/jpeg` / `image/webp` のみ許可。SVG等は拒否。
  宣言されたmime_typeと実際のファイル先頭バイト（マジックナンバー）が一致しない場合も拒否する。
- `replace`: 既存coverがある記事を上書きする場合のみ `true` を指定する。省略時（`false`）は
  既存coverがあれば書き込みを行わず `cover_exists` を返す。
- `dry_run`: `true` の場合、GitHubへの書き込み・PR作成を一切行わず、計画（保存先パス・
  既存cover有無・作成予定branch名）だけを返す。

戻り値（`status`で分岐、いずれもJSON）:

| status | 内容 |
|---|---|
| `success` | `article_path` / `image_path` / `branch` / `commit_sha` / `pr_number` / `pr_url` / `mergeable` |
| `dry_run` | `image_path` / `existing_image` / `planned_branch`（書き込みなし） |
| `cover_exists` | `current_image`（`replace: true`を付けて再実行すれば上書き可能） |
| `error` | `code` / `message`（Secret・スタックトレースは含めない） |

## 保存規約

既存のCLI（`npm run images:generate` / `images:import`）と同じ命名規則を維持する。

- 記事: `src/content/articles/<slug>-hero.<ext>`
- DATA LAB: `src/content/data-lab/<slug>-hero.<ext>`
- TOOLS: `src/content/tools/<slug>-hero.<ext>`

入力画像がJPEG/WebPの場合も無理にPNGへ変換せず、実際の拡張子をそのまま使う。

frontmatterの更新は、CLI側が使う `gray-matter`（全体再parse・再stringify、他フィールドの
YAMLスタイルまで再整形してしまう副作用が過去に実際発生した）をWorker側へ持ち込まず、
`functions/_lib/frontmatter-patch.ts` が正規表現で `image:` 行だけを置換/追加する。
これにより生成PRの差分は常に「画像ファイル追加＋`image:`行1行の変更」に限定される。

## GitHub書き込み方式

`gh` CLI（`scripts/lib/github-pr.mjs` が使っている方式）はCloudflare Workersランタイムに
サブプロセスが存在しないため使えない。`functions/_lib/github-client.ts` がfetchベースで
Git Data API（blob → tree → commit → ref更新）とPulls APIを直接呼ぶ。

1branchにつき1コミット（画像追加＋frontmatter更新をまとめて1コミット）で、`main`の最新コミット
を親としてPRを作成する。`replace: true`で拡張子が変わる場合は、同じtree内で旧ファイルを
`sha: null`指定して削除する（`images:import --force`のorphan-cleanupと同じ安全対策）。

## 認証方式（2方式対応、どちらか一方を設定）

`functions/_lib/github-client.ts` の `resolveGitHubToken()` が解決する。

1. **GitHub App（推奨・権限を最小化できる）**: `GITHUB_APP_ID` / `GITHUB_APP_PRIVATE_KEY` /
   `GITHUB_APP_INSTALLATION_ID` の3つが揃っていれば、RS256 JWTを署名してインストールトークン
   （1時間で失効）を都度取得する。必要な権限は `Contents: write` / `Pull requests: write` /
   `Metadata: read` のみ。
2. **Fine-grained PAT（簡易構成）**: 上記が無ければ `GITHUB_TOKEN` をそのままBearerとして使う。
   `hitoshi260828-dev/hobnova` リポジトリのみに絞ったfine-grained PATを強く推奨する
   （classic PATは全リポジトリへアクセスできてしまうため避ける）。

いずれのSecretも **Cloudflareダッシュボード側のPages環境変数（Secret）** で設定する
（`wrangler.toml` には書かない。既存の `TURNSTILE_SECRET_KEY` 等と同じ方式）。

## セキュリティ対策

- repoは `hitoshi260828-dev/hobnova`、base branchは `main` にコード側で固定（引数で変更不可）
- `article_path` のpath traversal・絶対パス・許可外ディレクトリを拒否
- 画像のMIME type allowlist（png/jpeg/webp）＋マジックバイト一致確認＋最大10MB
- 既存coverは `replace: true` を明示しない限り上書きしない
- mainへの直接push・自動mergeは一切行わない（PR作成のみ）
- GitHub認証情報はCloudflare Secretのみに保持し、エラーレスポンスにトークン値やスタック
  トレースを含めない（`cover-publish.test.ts` に非露出の確認テストあり）
- MCP自体の認証（ChatGPT→Worker）は既存のOAuth 2.1 + PKCE機構をそのまま再利用する
  （このtool専用の新しい認証は追加していない）

未実施（今後の課題）: Worker側のrate limit（既存の `checkOAuthLoginRateLimit` 等と同様の
KVベース制限を `publish_generated_image` 呼び出しにも追加できるが、呼び出し元がOAuth認証済み
の正規クライアントのみである前提のため今回は見送った。乱用の兆候があれば追加する）。

## 既知の制約：base64添付画像のサイズ

MCP仕様上、tool呼び出し引数で画像等のバイナリを渡す標準的な方法は現状base64文字列のみ
（2026年時点のSEP-2631等でファイル入力の正式な仕組みが議論中だが未確定）。ChatGPT側にも
「添付画像をツールへ送る」設定があるが、実運用では数MB超の画像でbase64が送信時に
truncateされる事例が報告されている。HOBNOVAのOpenAI cover生成物は実測1.5〜2.8MB程度
あるため、大きめの画像では途中で失敗する可能性がある。

今回はこのリスクを承知の上でbase64直接方式のみ実装した（新規インフラ不要・既存のMCP
エンドポイントに1tool足すだけで完結するため）。実際にPhase 12のE2Eテストで問題が
確認された場合の対応案:

- ChatGPT側で画像を軽量化してから送ってもらう運用でカバーする
- または、Cloudflare R2への一時アップロード経由の別tool（`request_upload_url`等）を
  追加実装する（今回は未実装。R2バケット作成という新規インフラ・新規費用が発生するため）

## 必要なセットアップ（ユーザー操作が必要）

1. GitHub側でfine-grained PAT（または GitHub App）を作成し、`hitoshi260828-dev/hobnova`
   リポジトリへ `Contents: write` / `Pull requests: write` / `Metadata: read` を付与する
2. Cloudflareダッシュボード → Pagesプロジェクト（hobnova） → Settings → Environment
   variables で `GITHUB_TOKEN`（または `GITHUB_APP_ID`/`GITHUB_APP_PRIVATE_KEY`/
   `GITHUB_APP_INSTALLATION_ID`）をSecretとして追加する
3. 本番へデプロイする（mainへこのブランチをマージ後、Cloudflare Pagesが自動ビルド）
4. ChatGPT側のカスタムコネクタ設定で、`publish_generated_image` toolが一覧に現れることを
   確認し、「添付画像をツールへ送る」設定を有効にする（ChatGPT UI側の操作）
5. 実画像でdry_run → 実行のE2E確認を行う

上記はいずれも新規Secret追加・外部公開・本番デプロイを伴うため、実施前にユーザーの
明示的な確認を取る。
