# 記事画像自動生成パイプライン

HOBNOVAの記事画像には2つの入手経路があり、どちらも同じ保存規約・Markdown挿入ロジック
（`scripts/lib/image-pipeline/`）を共有する。

- `scripts/generate-article-images.ts`: OpenAI Image API（アイキャッチ）・Cloudflare
  Workers AI（本文画像）で**API生成**する
- `scripts/import-generated-image.ts`: ChatGPT等で**既に生成済みのローカル画像ファイルを
  取り込む**（API呼び出しなし）

## images:import（外部生成画像の取り込み）

ChatGPT上で対話しながら作った画像をローカルへ保存し、そのファイルをそのまま記事へ採用する
CLI。OpenAI/Cloudflareの画像生成APIは一切呼び出さない。

```bash
# アイキャッチ
npm run images:import -- --article src/content/articles/xxxx.md \
  --image "C:/Users/you/Downloads/chatgpt-image.png" --type cover

# 本文画像（見出し指定）
npm run images:import -- --article src/content/articles/xxxx.md \
  --image "C:/Users/you/Downloads/chatgpt-image.png" --type inline \
  --after-heading "対象のH2見出しテキスト"

# 本文画像（セクション番号指定。1始まり、--after-headingの代わり）
npm run images:import -- --article src/content/articles/xxxx.md \
  --image "C:/Users/you/Downloads/chatgpt-image.png" --type inline --position 2
```

オプション: `--alt <text>`（未指定ならタイトル・見出しからルールベース自動生成）、
`--copy-only`（記事側は更新せず画像ファイルのコピーのみ行う）、`--dry-run`、`--force`
（既存カバーの上書き／二重挿入チェックのバイパス）。

対応形式: png / jpg / jpeg / webp / svg。**再圧縮・再エンコードは行わず元ファイルをそのまま
コピーする**（最適化処理を将来追加する場合に備え、画像取得層 `import-source.ts` と
HOBNOVA側の保存・更新ロジック `import-image.ts` を分離してある）。

保存規約・二重防止ロジックはAPI生成パイプラインと完全に共通（`article-file.ts` /
`markdown-insert.ts` を両CLIで共有）。カバーは既存があれば`--force`無しでスキップ、
本文画像は既存ファイルの最大連番+1を自動採番し、同一パスが本文へ既に挿入されていれば
`--force`無しでスキップする。

### 失敗時の安全性

画像ファイルのコピーに成功した後、frontmatter/Markdownの更新に失敗した場合は、コピー済みの
画像ファイルを自動的に削除してロールバックする（削除自体に失敗した場合は、処理を止めずに
孤立ファイルのパスを警告として出力する）。`--dry-run`時は一切の書き込みを行わない。

### 将来のChatGPT直接連携に向けた設計

`import-source.ts` は画像の取得元を抽象化しており、現状は`local-file`のみ対応しているが、
将来的に`base64`入力や`remote`（GitHub blobなど）を追加する場合も、この層へkindを増やす
だけでよく、`import-image.ts`（HOBNOVA側の保存・frontmatter/Markdown更新ロジック）は
変更不要な設計にしてある。

## generate（API自動生成）

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
| `CLOUDFLARE_IMAGE_MODEL` | 任意 | `@cf/black-forest-labs/flux-2-dev` |
| `CLOUDFLARE_IMAGE_STEPS` | 任意 | `25`（1〜50の範囲外・不正値は25へフォールバック。`flux-2-dev`等steps調整可能なモデルのみ有効） |
| `CLOUDFLARE_IMAGE_GUIDANCE` | 任意 | 未設定なら送信しない |

### モデルごとの送信方式（自動判定）

`requiresMultipart()`（モデル名に`flux-2`を含むかどうか）で、リクエスト形式を自動的に切り替える。

| モデル | 送信形式 | 送信フィールド |
|---|---|---|
| `@cf/black-forest-labs/flux-2-dev`（既定） | multipart/form-data | `prompt`, `width`, `height`, `steps`, `guidance`（設定時のみ） |
| `@cf/black-forest-labs/flux-2-klein-9b` | multipart/form-data | `prompt`, `width`, `height`, `guidance`（設定時のみ）。**stepsは固定のため送らない** |
| `@cf/black-forest-labs/flux-1-schnell`（JSON方式の旧世代モデル） | JSON | `prompt` のみ（width/height/steps/guidanceは実機未検証のため送らない） |

Content-Typeヘッダーはmultipart送信時に手動設定しない（`fetch`/undiciがFormDataから
boundary付きヘッダーを自動生成するため、手動設定するとboundaryが欠落して壊れる）。

### flux-2-klein-9bについて（既定から除外・再検証可能）

実機検証の結果、`@cf/black-forest-labs/flux-2-klein-9b`は現在のmultipart実装・アカウント・
REST直叩き経路で`6003 Request body is not valid json`エラーとなり生成できませんでした。
同一コード・同一アカウントで`@cf/black-forest-labs/flux-2-dev`は生成に成功しているため、
klein-9b固有の問題（アカウントのプラン要件、またはCloudflare側のモデル固有の不具合の
可能性）と判断し、既定モデルから外しています。`CLOUDFLARE_IMAGE_MODEL`に明示指定すれば
いつでも再検証できます。

## 本文画像の選定ロジック

`scripts/lib/image-pipeline/sections.ts` が、本文をH2見出し単位で分割し、見出し・本文の
キーワードからスコアリングして画像を入れる節を選ぶ（ルールベース。LLMによる本文解析は
行っていない）。

- 文字数に応じた目標枚数（上限）: 〜1,500字=1枚, 〜3,000字=2枚, 〜5,000字=3枚,
  それ以上=4枚（**この4枚がコスト暴走防止のハードキャップ**。文字数に関わらずこれを超えない）
- 除外: まとめ/結論/FAQ/よくある質問/注意事項/参考リンク 等の見出し
- 優先: 比較、使用シーン、仕組み・構造、ライフスタイル、選び方、購入判断、Before/After 等

## 概算コスト（flux-2-dev、steps=25、1024×1024）

Cloudflare公式料金表（2026年10月時点）によると、flux-2-devは
「出力512×512タイルあたり・ステップあたり $0.00041」。1024×1024出力は512×512タイル4枚分。

```
1枚あたり ≈ 4 tiles × 25 steps × $0.00041 = $0.041
```

| 1記事あたりの本文画像枚数 | 概算コスト |
|---|---|
| 1枚 | 約 $0.041 |
| 2枚 | 約 $0.082 |
| 3枚 | 約 $0.123 |
| 4枚（上限） | 約 $0.164 |

アイキャッチ（OpenAI `gpt-image-1`）は別料金体系（本リポジトリでは未計測）。
`CLOUDFLARE_IMAGE_STEPS`を下げるとコストは比例して下がる（例: steps=10なら上記の40%）。
料金は変更される可能性があるため、最新値は
[Workers AI Pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/) を参照。

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
