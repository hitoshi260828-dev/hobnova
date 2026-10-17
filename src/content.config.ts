import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';
import { ARTICLE_CATEGORY_IDS, NEWS_TOPIC_IDS } from './consts';

// CAMP / GADGET / DIGITAL MARKETING はスキーマが同一のため単一コレクション + category enum で管理する。
// カテゴリを追加する場合は src/consts.ts の ARTICLE_CATEGORY_IDS / CATEGORIES に値を足せばよい。
const articleCategories = ARTICLE_CATEGORY_IDS;

const articles = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/articles' }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      description: z.string(),
      publishDate: z.coerce.date(),
      updatedDate: z.coerce.date().optional(),
      category: z.enum(articleCategories),
      tags: z.array(z.string()).default([]),
      image: image().optional(),
      draft: z.boolean().default(false),
      featured: z.boolean().default(false),
      author: z.string().default('HOBNOVA編集部'),
      source: z.string().optional(),
    }),
});

// DATA LAB: 記事とは frontmatter が異なる（主要指標・データ出典など）ため別コレクション。
const dataLab = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/data-lab' }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      description: z.string(),
      publishDate: z.coerce.date(),
      updatedDate: z.coerce.date().optional(),
      tags: z.array(z.string()).default([]),
      image: image().optional(),
      draft: z.boolean().default(false),
      featured: z.boolean().default(false),
      author: z.string().default('HOBNOVA編集部'),
      source: z.string().optional(),
      // TOPページ／一覧カードに出す簡易統計
      stats: z
        .array(
          z.object({
            label: z.string(),
            value: z.string(),
          }),
        )
        .optional(),
      // 詳細ページのグラフ（Chart.js）。type未指定時は 'bar'。
      chart: z
        .object({
          type: z.enum(['bar', 'line', 'pie']).default('bar'),
          labels: z.array(z.string()),
          series: z.array(
            z.object({
              label: z.string(),
              data: z.array(z.number()),
            }),
          ),
        })
        .optional(),
      // ランキング表
      ranking: z
        .array(
          z.object({
            rank: z.number(),
            label: z.string(),
            value: z.string(),
          }),
        )
        .optional(),
      // 汎用データテーブル
      table: z
        .object({
          headers: z.array(z.string()),
          rows: z.array(z.array(z.string())),
        })
        .optional(),
      // 条件検索・フィルターなど、静的なfrontmatterでは表現できないインタラクティブな
      // 探索UIを埋め込む場合に指定する（TOOLSのtoolIdと同じパターン）。
      explorerId: z.string().optional(),
    }),
});

// TOOLS: 本文は解説用。実際の計算UIは toolId で対応するAstroコンポーネントを紐付ける想定。
const tools = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/tools' }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      description: z.string(),
      publishDate: z.coerce.date(),
      updatedDate: z.coerce.date().optional(),
      tags: z.array(z.string()).default([]),
      image: image().optional(),
      draft: z.boolean().default(false),
      featured: z.boolean().default(false),
      toolId: z.string(),
    }),
});

// NEWS: 朝刊/夕刊まとめ記事専用コレクション（通常記事とは用途・公開頻度・判定方法が異なるため分離）。
// ファイル名を `{YYYY-MM-DD}-{edition}.md`（例: 2026-10-18-morning.md）に統一することで、
// スラッグ自体が日付+editionの一意キーになる（他コレクション同様、slugはfrontmatterへ持たせず
// ファイル名をそのまま使う）。ただし「同一ファイルパスへの書き込みは自然に衝突する」が成立する
// かどうかは、将来の自動投稿がどのGitHub書き込み方式を使うかに依存する点に注意。Contents API
// （`PUT /contents/{path}`）はsha未指定時に既存ファイルへの上書きを拒否するため安全だが、
// 本リポジトリの既存実装（functions/_lib/cover-publish.ts 等）が使うGit Data API
// （blob/tree直接構築）は、同じpathのtree entryを**無言で上書き**する。将来この命名規約に
// 依存した二重投稿防止を実装する場合は、書き込み前に当該pathの既存ファイル有無を
// 明示的に確認するロジックを別途必ず入れること（ファイル名だけでは自動的に守られない）。
//
// daily-publish-check.mjs（scripts/lib/github-pr.mjs のCONTENT_PATH）は意図的に
// articles/data-lab/tools のみを対象とし、news/ は含めていない。通常記事（1日1本、JST12:00）と
// ニュース（将来: 朝夜1本ずつの別スケジュール）の「本日分は公開済みか」判定が混線しないようにする
// ため。news用の判定・自動マージは将来別workflowとして分離する想定。
const news = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/news' }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      description: z.string(),
      publishedAt: z.coerce.date(),
      updatedAt: z.coerce.date().optional(),
      edition: z.enum(['morning', 'evening']),
      topics: z.array(z.enum(NEWS_TOPIC_IDS)).min(1),
      cover: image().optional(),
      summary: z.string().optional(),
      sourceCount: z.number().int().nonnegative().optional(),
      draft: z.boolean().default(false),
      // 各ニュース項目の出典。複雑なCMSは作らず、Markdown/frontmatterで安全に扱える範囲に留める。
      sources: z
        .array(
          z.object({
            name: z.string(),
            url: z.string().url(),
            publishedDate: z.coerce.date().optional(),
            accessedDate: z.coerce.date().optional(),
          }),
        )
        .default([]),
    }),
});

export const collections = { articles, dataLab, tools, news };
