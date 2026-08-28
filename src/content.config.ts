import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';
import { ARTICLE_CATEGORY_IDS } from './consts';

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

export const collections = { articles, dataLab, tools };
