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
- Tailwind CSS v4（`@tailwindcss/vite`、`@theme` でデザイントークンを一元管理）
- `@astrojs/sitemap`（sitemap-index.xml自動生成）
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
│  ├─ layout/   Header, Footer（ヘッダーのモバイルメニューJSはHeader.astro内にinline scriptで実装）
│  ├─ ui/       Logo, CategoryIcon, Card, Badge, SectionHeading
│  ├─ home/     Hero, CategoryGrid, NewDiscoveries, Featured, DataLabPreview, ToolsPreview, AboutSection
│  ├─ article/  記事詳細実装フェーズで追加予定（ArticleHeader, TableOfContents, ShareButtons, RelatedArticles, AuthorBox, TagList）
│  ├─ datalab/  DATA LAB詳細実装フェーズで追加予定（StatCard, ChartWrapper, RankingTable, DataTable, SourceNote）
│  ├─ tools/    TOOLS詳細実装フェーズで追加予定
│  └─ seo/      SEOHead（title/description/canonical/OGP/Xカード）, JsonLd（WebSite/Organization）
├─ layouts/
│  └─ BaseLayout.astro（全ページ共通。Header/Footer/SEOHead/JsonLdを内包）
├─ content.config.ts   3コレクション定義（articles / dataLab / tools）
├─ content/
│  ├─ articles/   CAMP・GADGET・DIGITAL MARKETING（category enumで区別、スキーマ共通）
│  ├─ data-lab/
│  └─ tools/
├─ pages/
│  ├─ index.astro       TOPページ（実装済み）
│  └─ robots.txt.ts     実装済み
├─ styles/global.css    Tailwind import + @theme デザイントークン + ベーススタイル
├─ lib/format.ts        日付整形などの共通ユーティリティ
└─ consts.ts             サイト名・タグライン・カテゴリ定義・ナビ構成を一元管理
```

**未実装（承認後の次フェーズ）**: `[category]/index.astro`, `[category]/[slug].astro`,
`data-lab/index.astro`, `data-lab/[slug].astro`, `tools/index.astro`, `tools/[slug].astro`,
`about.astro`, `privacy.astro`, `404.astro`。TOPページ内のリンクはこれらのURLを先に指しているため、
実装前はリンク切れになる（想定内）。

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

### タイポグラフィ

- 日本語本文: Noto Sans JP Variable（`font-family: "Noto Sans JP Variable"`）
- 英数字: Inter Variable
- 本文は日本語可読性優先。base 16px・行間1.8前後
- 見出しは英語ラベルを主、日本語を副として小さく添える（下記5章のルール参照）

### コンポーネント設計方針

- カード系（カテゴリ／記事／DATA LAB／TOOLS）は `src/components/ui/Card.astro` を土台に統一
- 新しい見出しセクションは `SectionHeading.astro`（英語メイン・日本語サブ、`moreHref`で「もっと見る」リンク）を使う
- ロゴは `Logo.astro`（`variant="full" | "mark"`）。実データを `src/assets/brand/` に配置済み
  （`hobnova-logo-full.png`＝ワードマーク入りフルロゴ、`hobnova-mark.png`＝ヘキサゴンのみ切り出し版）。
  `astro:assets` の `<Image>` で自動的にWebP変換・最適化される。元データは `design-reference/` に保管
  （`hobnova-logo-original.png`＝ロゴ原本、`hobnova-brand-guide.png`＝カラー/フォント/アイコンの
  ブランドガイド。カラートークンとフォント選定はこのガイドと整合済み）。
  ロゴを差し替える場合は `src/assets/brand/` の2ファイルを置き換えるだけでよい
- JavaScriptはAstro Islandsで必要な箇所のみ。TOPページはモバイルメニュー開閉の軽量inline scriptのみ

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
2. `src/content.config.ts` の `articleCategories` に enum値を追加
3. ページファイルの追加は不要（`[category]` 動的ルートが自動対応する設計、記事一覧/詳細実装時）

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

## 9. DATA LAB作成ルール（`src/content/data-lab/*.md`）

記事と同様のfrontmatterに加え、`stats`（`{label, value}[]`）でTOP/一覧カードに出す主要指標を指定できる。
本格的なグラフ描画ライブラリは未選定（DATA LAB詳細ページ実装フェーズで別途決定）。

## 10. TOOLS作成ルール（`src/content/tools/*.md`）

`toolId` で対応する対話UIコンポーネントを紐付ける想定（詳細ページ実装フェーズで
`ToolLayout.astro` から `toolId` に応じて計算コンポーネントを出し分ける）。

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

## 14. 今後の展開（承認後）

記事一覧・詳細ページ → DATA LAB詳細 → TOOLS詳細 → ABOUT/プライバシーポリシー の順で拡張する。
デザインシステム・URL構造はTOPページ承認時点のものを踏襲し、大幅変更は行わない。
