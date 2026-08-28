# CLAUDE.md — HOBNOVA

このファイルはHOBNOVAプロジェクト専用のガイドです。別セッションのClaude Codeでも
デザイン・実装方針がぶれないよう、作業前に必ず読むこと。ワークスペース全体の方針は
1つ上の階層の `code作業場/CLAUDE.md` を参照。

---

## 1. ブランドコンセプト

- サイト名: **HOBNOVA**（HOBBY × NOVA）
- コンセプト: 「好奇心から、新しい発見を。」
- キャンプ・ガジェット・データ分析・デジタルマーケティング・Webツールなど、運営者自身が
  興味を持ったテーマを「試す」「調べる」「分析する」「考える」「作る」ことで新しい発見を届ける
  個人メディア。単なる雑記ブログではなく「大人の好奇心を研究する個人ラボ」を目指す。
- 著者表記は個人名を出さず **「HOBNOVA編集部」** に統一する（個人情報保護）。

## 2. 技術構成

- Astro 7（TypeScript strict）+ Content Collections（Content Layer API / `glob` loader）
- Tailwind CSS v4（`@tailwindcss/vite`、`@theme` でデザイントークンを一元管理）+ `@tailwindcss/typography`
  （記事・DATA LAB・TOOLS解説文などMarkdown本文の`prose`クラスに使用）
- `@astrojs/sitemap`（sitemap-index.xml自動生成）
- Chart.js（`chart.js/auto`）— DATA LABのグラフとTOOLSのシミュレーターグラフに使用。
  コンポーネント内`<script>`でimportしているため、そのコンポーネントを使うページだけに
  バンドルされる（Astro/Viteのページ単位バンドリング）
- フォントはセルフホスト: `@fontsource-variable/inter`, `@fontsource-variable/noto-sans-jp`
  （外部リクエストなし。unicode-range分割済みなので使用文字のみダウンロードされる）
- Cloudflare Pages（Freeプラン）での静的ホスティングを前提とした `output: 'static'`
- パッケージマネージャ: npm
- **Astro 7ではcontent collectionsの設定ファイル名は `src/content.config.ts`**（`src/content/config.ts` ではない。旧パスは LegacyContentConfigError になる）

## 3. ディレクトリ構成

`design-reference/`（プロジェクトルート、src外）にはロゴ原本とブランドガイド画像を保管している。
ビルド対象外のドキュメント用フォルダ。

```
src/
├─ components/
│  ├─ layout/   Header, Footer, Breadcrumb（TOP以外の全ページ共通パンくず）
│  ├─ ui/       Logo, CategoryIcon, Card（media名前付きスロット対応）, Badge,
│  │            SectionHeading, ImagePlaceholder（画像未指定時のプレースホルダー）
│  ├─ home/     Hero, CategoryGrid, NewDiscoveries, Featured, DataLabPreview, ToolsPreview, AboutSection
│  ├─ article/  ArticleHeader, TableOfContents, TagList, AuthorBox, ShareButtons,
│  │            RelatedArticles, PrevNextNav
│  ├─ datalab/  ChartBlock（Chart.js）, RankingTable, DataTable
│  ├─ tools/    RentVsBuySimulator, CampBudgetCalculator（ツール追加時はここに1コンポーネント追加）
│  └─ seo/      SEOHead, JsonLd（WebSite/Organization。全ページ共通）,
│               ArticleJsonLd, BreadcrumbJsonLd（記事・DATA LAB・TOOLSページで使用）
├─ layouts/
│  ├─ BaseLayout.astro    全ページ共通。Header/Footer/SEOHead/JsonLd + `head-extra`名前付きスロット
│  ├─ ArticleLayout.astro 記事詳細用（本文+サイドバーTOC、PC）
│  ├─ DataLabLayout.astro DATA LAB詳細用（ネイビーヘッダー帯 + 指標/グラフ/テーブル/考察）
│  └─ ToolLayout.astro    TOOLS詳細用（説明 → `tool`スロット → 解説本文）
├─ content.config.ts   3コレクション定義（articles / dataLab / tools）
├─ content/
│  ├─ articles/   CAMP・GADGET・DIGITAL MARKETING（category enumで区別、スキーマ共通）
│  ├─ data-lab/   stats/chart/ranking/table を任意で指定可能
│  └─ tools/      toolId で対応する計算コンポーネントに紐付け
├─ pages/
│  ├─ index.astro, robots.txt.ts
│  ├─ [category]/index.astro, [category]/[slug].astro   記事一覧・詳細
│  ├─ data-lab/index.astro, data-lab/[slug].astro
│  ├─ tools/index.astro, tools/[slug].astro
│  └─ about.astro, privacy.astro, 404.astro
├─ styles/global.css    Tailwind import + @theme デザイントークン + ベーススタイル
├─ lib/format.ts        日付整形などの共通ユーティリティ
└─ consts.ts             サイト名・タグライン・カテゴリ定義・ナビ構成・ARTICLE_CATEGORY_IDSを一元管理
```

**未実装（将来対応）**: タグ一覧・タグ詳細ページ（`/tags/`）。記事・DATA LABの`TagList`は
現状リンクなしのバッジ表示。

## 4. デザインシステム

### カラー（`src/styles/global.css` の `@theme` に定義。値の変更は必ずここで行う）

| 変数 | 値 | 用途 |
|---|---|---|
| `--color-navy` | `#111827` | ブランド基調・見出し |
| `--color-charcoal` | `#374151` | サブテキスト |
| `--color-text` | `#1f2937` | 本文 |
| `--color-bg-light` | `#f5f7fa` | ページ背景 |
| `--color-white` | `#ffffff` | カード背景等 |
| `--color-accent` | `#3b82f6` | リンク・アイコン強調（使いすぎない） |
| `--color-border` | `#e5e7eb` | 罫線 |

配分ルール: 白 → ライトグレー → ネイビー/チャコール → 少量ブルー。黒一色のダークサイトにはしない。
Chart.jsのグラフ配色も同トーン（`#3B82F6` `#111827` `#60A5FA` `#374151` 等）で統一している
（`ChartBlock.astro` の `PALETTE` 定数）。

### タイポグラフィ

- 日本語本文: Noto Sans JP Variable（`font-family: "Noto Sans JP Variable"`）
- 英数字: Inter Variable
- 本文は日本語可読性優先。base 16px・行間1.8前後
- 見出しは英語ラベルを主、日本語を副として小さく添える（下記5章のルール参照）
- Markdown本文は `@tailwindcss/typography` の `prose` クラスを使用
  （`prose-headings:text-navy prose-a:text-accent` 等でブランドカラーに合わせている）

### コンポーネント設計方針

- カード系（カテゴリ／記事／DATA LAB／TOOLS）は `src/components/ui/Card.astro` を土台に統一。
  `slot="media"` にアイキャッチ画像/プレースホルダー、既定スロットにパディング付き本文を置く
- 画像は `ImagePlaceholder.astro` を使う。`image`propに値があれば`astro:assets`の`<Image>`で最適化表示、
  無ければ控えめなドットパターン+アイコンのプレースホルダーを表示する。記事/DATA LAB/TOOLSの
  frontmatterに `image: ./photo.jpg` を追加するだけで実画像に自動切り替わる
- 新しい見出しセクションは `SectionHeading.astro`（英語メイン・日本語サブ、`moreHref`で「もっと見る」リンク）を使う
- パンくずは `Breadcrumb.astro`（表示用）+ `BreadcrumbJsonLd.astro`（構造化データ）をセットで使う
- ロゴは `Logo.astro`（`variant="full" | "mark"`）。実データを `src/assets/brand/` に配置済み
  （`hobnova-logo-full.png`＝ワードマーク入りフルロゴ、`hobnova-mark.png`＝ヘキサゴンのみ切り出し版）。
  `astro:assets` の `<Image>` で自動的にWebP変換・最適化される。元データは `design-reference/` に保管
  ロゴを差し替える場合は `src/assets/brand/` の2ファイルを置き換えるだけでよい
- JavaScriptはAstro Islandsで必要な箇所のみ。TOPページのモバイルメニュー開閉、DATA LAB/TOOLSの
  Chart.js、TOOLSの計算ロジック、ShareButtonsのコピー機能はいずれも該当コンポーネントの
  `<script>`内に閉じており、他ページへは送信されない

## 5. 日本語×英語 表記ルール

「ブランド・カテゴリ・装飾 = 英語」「UI・説明・本文 = 日本語」。
すべてを二重表記して画面がうるさくならないよう、装飾的な見出しのみ英語メイン＋日本語サブ、
本文・ボタン・説明文は日本語のみとする。

## 6. URLルール

- 通常記事（CAMP/GADGET/MARKETING）: `/[category]/[slug]/`
- DATA LAB: `/data-lab/[slug]/`
- TOOLS: `/tools/[slug]/`
- 末尾スラッシュ必須（`astro.config.mjs` の `trailingSlash: 'always'`）
- スラッグは小文字ハイフン区切り。コンテンツファイル名がそのままスラッグ（`entry.id`）になる

## 7. カテゴリ追加ルール

1. `src/consts.ts` の `CATEGORIES` 配列に追加（`id`, `labelEn`, `labelJa`, `navLabelEn`, `href`, `description`）
2. 通常記事カテゴリ（DATA LAB/TOOLS以外）を増やす場合は `src/consts.ts` の `ARTICLE_CATEGORY_IDS` にも
   値を追加する（`content.config.ts` の category enum はここから自動的に生成される）
3. ページファイルの追加は不要（`[category]` 動的ルートが `ARTICLE_CATEGORY_IDS` を元に自動対応）

## 8. 記事作成ルール（`src/content/articles/*.md`）

frontmatter必須項目:

```yaml
title: string
description: string
publishDate: YYYY-MM-DD
category: camp | gadget | marketing
tags: string[]
draft: false
```

任意項目: `updatedDate`, `image`, `featured`, `author`（省略時 "HOBNOVA編集部"）, `source`

本文はMarkdown。見出し（H2/H3）は自動的に目次（TOC）に反映される
（`astro:content` の `render()` が返す `headings` を使用、remarkプラグイン不要）。

## 9. DATA LAB作成ルール（`src/content/data-lab/*.md`）

記事と同様のfrontmatterに加え、以下を任意で指定できる:

```yaml
stats:               # 主要指標カード
  - label: string
    value: string
chart:                # Chart.jsで描画するグラフ（bar/line/pie）
  type: bar | line | pie
  labels: string[]
  series:
    - label: string
      data: number[]
ranking:              # ランキング表
  - rank: number
    label: string
    value: string
table:                # 汎用データテーブル
  headers: string[]
  rows: string[][]
```

フィルター・年代選択などのインタラクティブな絞り込みは未実装（将来追加できるよう
`ChartBlock`/`RankingTable`/`DataTable`は独立したpropsベースのコンポーネントにしてある）。

## 10. TOOLS作成ルール（`src/content/tools/*.md`）

frontmatterの `toolId` で対応する計算コンポーネントに紐付ける。新しいツールを追加する手順:

1. `src/components/tools/` に計算コンポーネント（`<script>`内でDOM操作/計算/必要ならChart.js）を作成
2. `src/content/tools/*.md` に frontmatter（`toolId`含む）+ 解説本文を追加
3. `src/pages/tools/[slug].astro` の分岐に `{entry.data.toolId === 'xxx' && <XxxComponent />}` を追加

既存2ツール（`rent-vs-buy` / `camp-budget`）が実装パターンの参考になる。

## 11. コーディングルール

- コンポーネントは `.astro`（Islands不要な限りJSは使わない）
- スタイリングはTailwindユーティリティ + `@theme` トークンのみ。生CSSを増やさない
- 定数・ナビ構成・カテゴリ定義は `src/consts.ts` に集約し、コンポーネント側にハードコードしない
- 個人情報（実名・メールアドレス等）をコード・コンテンツ・コミットに含めない

## 12. 禁止事項

- ダークサイト化（黒一色の背景）
- 過度な宇宙的装飾（NOVA要素は星・ドット程度の控えめな表現に留める）
- 承認なしのデザイン大幅変更
- 個人を特定する情報の掲載

## 13. Build / Check

```bash
npm run dev      # 開発サーバー（astro dev --background も利用可）
npm run build    # 本番ビルド（dist/に出力）
npm run preview  # ビルド結果をローカルプレビュー
npx astro check  # 型チェック・診断
```

Cloudflare Pages設定はビルドコマンド `npm run build` / 出力ディレクトリ `dist`。

## 14. 現在の状態 / 今後の展開

TOP・記事一覧/詳細・DATA LAB一覧/詳細・TOOLS一覧/詳細・ABOUT/プライバシーポリシー/404 まで
実装済み（19ページビルド、`astro check` 0エラー）。今後は主に「記事を書く」「DATA LABを追加する」
「TOOLSを追加する」の運用フェーズに入る。デザインシステム・URL構造・コンポーネント設計は
承認済みのものを踏襲し、大幅変更は行わない。タグ一覧ページ、記事内の実画像差し替え、
ドメイン確定（`SITE_URL`/`astro.config.mjs`の`site`）、GitHub連携・Cloudflare Pagesデプロイは未着手。
