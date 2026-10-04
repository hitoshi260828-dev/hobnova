# 記事画像自動生成パイプライン

`scripts/generate-article-images.ts` は、HOBNOVAの記事に対してアイキャッチ画像（OpenAI
Image API）と本文画像（Cloudflare Workers AI）を自動生成し、既存のAstroプロジェクト内へ
保存・Markdownへ自動挿入するCLIです。

## 前提

- アイキャッチ画像は、既存の記事（`src/content/articles/*.md(x)`）の慣習に合わせ、
  **記事ファイルと同じディレクトリ**に `{slug}-hero.png` として保存し、frontmatterの
  `image: "./{slug}-hero.png"` を自動更新します（`content.config.ts` の
  `image: image().optional()` はAstroの画像パイプラインが相対パスを解決する仕組みのため、
  `public/` 以下の絶対パスは使えません）。
- 本文（inline）画像は、現状どの記事にも挿入前例がなかったため、タスク仕様の案を採用し
  `public/images/articles/{slug}/inline-NN.jpg` に保存し、Markdown本文へ
  `![alt](/images/articles/{slug}/inline-NN.jpg)` の絶対パスで参照します。

## 使い方

```bash
npm run images:generate -- src/content/articles/xxxx.md
npm run images:generate -- src/content/articles/xxxx.md --dry-run
npm run images:generate -- src/content/articles/xxxx.md --force
npm run images:generate -- src/content/articles/xxxx.md --cover-only
npm run images:generate -- src/content/articles/xxxx.md --inline-only
```

- `--dry-run`: API呼び出しを一切行わず、生成予定の画像（保存先・プロンプト・alt）を表示するだけ。
- 既にアイキャッチ/本文画像が存在する記事はデフォルトで再生成しない（二重生成防止）。
  `--force` で強制再生成できる。
- `--cover-only` / `--inline-only` は同時指定不可。

## 環境変数

`.env.example` を参照。ローカルでは `HOBNOVA/.env.local`（Git管理外、`.gitignore`済み）、
CIではGitHub Secretsを使う。

| 変数 | 必須 | 既定値 |
|---|---|---|
| `OPENAI_API_KEY` | アイキャッチ生成に必須 | なし（未設定ならアイキャッチをスキップし、本文画像生成は継続） |
| `OPENAI_IMAGE_MODEL` | 任意 | `gpt-image-1` |
| `CLOUDFLARE_ACCOUNT_ID` | 本文画像生成に必須 | なし（未設定なら本文画像生成をスキップ） |
| `CLOUDFLARE_API_TOKEN` | 本文画像生成に必須 | なし |
| `CLOUDFLARE_IMAGE_MODEL` | 任意 | `@cf/black-forest-labs/flux-1-schnell` |

## 本文画像の選定ロジック

`scripts/lib/image-pipeline/sections.ts` が、本文をH2見出し単位で分割し、見出し・本文の
キーワードからスコアリングして画像を入れる節を選ぶ（ルールベース。LLMによる本文解析は
行っていない）。

- 文字数に応じた目標枚数（上限）: 〜1,500字=1枚, 〜3,000字=2枚, 〜5,000字=3枚,
  それ以上=4枚（**この4枚がコスト暴走防止のハードキャップ**。文字数に関わらずこれを超えない）
- 除外: まとめ/結論/FAQ/よくある質問/注意事項/参考リンク 等の見出し
- 優先: 比較、使用シーン、仕組み・構造、ライフスタイル、選び方、購入判断、Before/After 等

## コスト安全装置

- アイキャッチ: 1記事につき最大1枚（アーキテクチャ上、常に1個以下しか計画されない）
- 本文画像: 1記事につき最大4枚（上記ハードキャップ）
- 各画像の生成失敗時のリトライは最大2回（無限リトライしない）
- `--dry-run` 時はAPIリクエストを一切送信しない
- 1件の画像生成失敗は他の画像生成を止めない（独立したtry/catch）。Markdown更新は
  成功した画像だけを反映し、途中成功分を失わない

## 日次記事生成パイプラインとの統合について

調査の結果、**このリポジトリ内には「日次記事生成スクリプト」に相当する既存の自動実行処理は
存在しませんでした**（`scripts/` にあるのは、記事PR作成後にLINE通知を送る
`notify-article-ready.mjs` と、楽天アフィリエイトリンク更新スクリプトのみ）。記事そのものの
執筆・PR作成は、このリポジトリの外側（別のAIエージェントによるPRベースのワークフロー）で
行われているとみられます。

そのため、本タスクのPhase 5（既存の日次記事生成パイプラインへの統合）は、具体的な既存コードが
見つからず実装していません。実務上の統合ポイントとしては、記事PRを作成する側のプロセスが、
PR作成前に `npm run images:generate -- <新規記事のパス>` を実行する一手順として組み込むのが
最も自然です（必要であれば、`.github/workflows/article-ready-notification.yml` と同様の
パターンで、PRに特定のラベルが付いた場合にのみ画像生成を行うGitHub Actionsワークフローを
別途追加することもできますが、今回は既存ワークフローを変更していません）。

## 未実施（残課題）

- 実際のAPIキーを使った実画像生成テスト（OpenAI 1枚 / Cloudflare 2枚）は、APIキーが
  利用できなかったため未実施です。`--dry-run` でのプロンプト・保存先・alt生成の確認、
  およびHTTPレスポンスをモックした単体テスト（401/429/500/base64デコード等）までは
  完了しています。
