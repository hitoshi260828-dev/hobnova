# HOBNOVA

「好奇心から、新しい発見を。」

HOBNOVA（ホブノヴァ、HOBBY × NOVA）は、キャンプ・ガジェット・データ分析・デジタルマーケティング・
Webツールなど、運営者自身が興味を持ったテーマを「試す」「調べる」「分析する」「作る」ことで
新しい発見を届ける個人メディアです。

デザイン・実装方針の詳細は [CLAUDE.md](./CLAUDE.md) を参照してください（Claude Codeでの継続開発を前提としています）。

---

## 1. 概要

- カテゴリ: CAMP / GADGET / DATA LAB / DIGITAL MARKETING / TOOLS
- 技術スタック: Astro 7 + TypeScript + Tailwind CSS v4 + Content Collections
- ホスティング: Cloudflare Pages（Freeプラン想定）

## 2. セットアップ

Node.js（LTS, 22系以上）が必要です。

```bash
npm install
```

## 3. ローカル起動

```bash
npm run dev
```

`http://localhost:4321` で確認できます。

## 4. ビルド

```bash
npm run build     # dist/ に静的ファイルを出力
npm run preview   # ビルド結果をローカルで確認
npx astro check   # 型チェック・診断
```

## 5. 記事を追加する（CAMP / GADGET / DIGITAL MARKETING）

`src/content/articles/` に Markdown ファイルを追加します。ファイル名がそのままURLスラッグになります
（例: `src/content/articles/my-new-post.md` → `/camp/my-new-post/`）。

```markdown
---
title: "記事タイトル"
description: "検索結果やOGPに使われる説明文"
publishDate: 2026-09-01
category: "camp" # camp | gadget | marketing
tags: ["タグ1", "タグ2"]
draft: false
featured: false
---

本文をMarkdownで記述します。
```

Claude Codeに「〇〇についてCAMPカテゴリの記事を書いて」のように自然言語で指示すれば、
このフォーマットに沿って下書きを作成できます。

## 6. DATA LABコンテンツを追加する

`src/content/data-lab/` に Markdown ファイルを追加します。`stats`（主要指標）に加えて、
`chart`（Chart.jsで描画するグラフ）・`ranking`（ランキング表）・`table`（データテーブル）を
任意で指定できます。

```markdown
---
title: "データタイトル"
description: "説明文"
publishDate: 2026-09-01
tags: ["市場データ"]
draft: false
source: "出典（例: 総務省統計局）"
stats:
  - label: "指標名"
    value: "数値"
chart:
  type: "line" # bar | line | pie
  labels: ["2024", "2025", "2026"]
  series:
    - label: "系列名"
      data: [10, 12, 15]
ranking:
  - rank: 1
    label: "項目名"
    value: "数値"
table:
  headers: ["列1", "列2"]
  rows:
    - ["値1", "値2"]
---

分析・考察本文。
```

## 7. TOOLSを追加する

新しいツールを追加する場合、Claude Codeへの指示（例:「〇〇計算ツールを追加して」）で
以下の3ステップを行います。

1. `src/components/tools/` に計算ロジック付きのコンポーネントを作成
2. `src/content/tools/` に Markdown で説明文を追加（`toolId` で1のコンポーネントに紐付け）
3. `src/pages/tools/[slug].astro` の分岐に `toolId` の条件を1行追加

```markdown
---
title: "ツール名"
description: "説明文"
publishDate: 2026-09-01
tags: ["シミュレーター"]
draft: false
toolId: "unique-tool-id"
---

ツールの解説本文（計算の前提条件・注意点など）。
```

既存の `rent-vs-buy`（住宅購入 vs 賃貸シミュレーター）・`camp-budget`（キャンプギア予算計算機）
が実装の参考になります。

## 8. GitHubへpushする

このフォルダ（`HOBNOVA/`）自体をGitリポジトリのルートとして管理します（ローカルでは
`git init`済み・コミット済みです）。GitHubに新規リポジトリを作成し、リモートを追加してpushしてください。

```bash
git remote add origin https://github.com/<your-account>/hobnova.git
git branch -M main
git push -u origin main
```

## 9. Cloudflare Pages設定

1. Cloudflare Dashboard → Workers & Pages → Create → Pages → GitHubリポジトリを接続
2. ビルド設定
   - Framework preset: Astro
   - Build command: `npm run build`
   - Build output directory: `dist`
3. 以降はGitHubへのpushをトリガーに自動デプロイされます

## 10. 独自ドメイン設定

1. Cloudflare Pagesのプロジェクト → Custom domains → ドメインを追加
2. ドメインが確定したら、以下2箇所を実ドメインに更新してください
   - `astro.config.mjs` の `site`
   - `src/consts.ts` の `SITE_URL`

## 11. Google Search Console設定

1. Google Search Consoleでプロパティを追加（URLプレフィックス方式を推奨）
2. HTMLタグ or DNSレコードで所有権を確認
3. サイトマップとして `https://<your-domain>/sitemap-index.xml` を送信
   （`@astrojs/sitemap` が自動生成）
