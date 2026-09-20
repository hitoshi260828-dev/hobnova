# scripts/

HOBNOVAのAIエージェント記事制作ワークフロー用スクリプト。既存のClaude Code用LINE通知
（`claude-line-notifier/`、別リポジトリ）とは独立しており、互いの挙動に影響しない。

## notify-article-ready.mjs

記事PR作成後、AIが明示的に実行する「記事完成」LINE通知。

```bash
node scripts/notify-article-ready.mjs \
  --pr 12 \
  --title "記事タイトル" \
  --summary "概要（1〜2文）" \
  [--preview-url "https://..."]   # 省略時はPRコメントから自動解決
  [--dry-run]                      # LINEへ送らず内容をconsole出力のみ
```

引数の代わりに環境変数（`ARTICLE_TITLE` / `ARTICLE_SUMMARY` / `PR_NUMBER` / `PREVIEW_URL` /
`DRY_RUN=1`）でも指定できる（GitHub Actionsからの呼び出しを想定）。

### 動作
1. 指定PRのGitHub Actions・Cloudflare Pagesなど全status checkが完了するまでポーリング
   （timeout: 既定5分、`--checks-timeout-ms`で変更可）。**いずれかが失敗、またはtimeoutした
   場合は通知を送信しない**
2. Cloudflare PagesがPRへ投稿するコメントからPreview URLを解決（timeout: 既定3分）。
   見つからない場合はブランチ名から決定論的に導出したBranch Preview URLへfallback
3. LINE Messaging APIへpush送信

### 秘密情報
`LINE_CHANNEL_ACCESS_TOKEN` / `LINE_USER_ID` は `process.env` から読む。ローカル実行時、
未設定であれば `claude-line-notifier/.env`（sibling リポジトリ、Git管理外）を読み込む
フォールバックがある。CI（GitHub Actions Secrets経由で環境変数が注入される想定）では
このフォールバックは使われない。

### GitHub CLI依存
PRのstatus check確認・コメント取得は `gh` コマンドのサブプロセス呼び出しで行う。ローカルでは
キーリング認証済みの`gh`をそのまま使い、GitHub Actions上ではプリインストールの`gh`が
`GITHUB_TOKEN`を自動的に使うため、コード変更なしで両方の環境で動く設計。
