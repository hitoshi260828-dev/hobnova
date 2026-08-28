import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

// CAMP / GADGET / DIGITAL MARKETING はスキーマが同一のため単一コレクション + category enum で管理する。
// カテゴリを追加する場合はここに値を足し、src/consts.ts の CATEGORIES にも追加する。
const articleCategories = ['camp', 'gadget', 'marketing'] as const;

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
      // TOPページ／一覧カードに出す簡易統計（本格的なグラフはDATA LAB詳細実装フェーズで追加）
      stats: z
        .array(
          z.object({
            label: z.string(),
            value: z.string(),
          }),
        )
        .optional(),
    }),
});

// TOOLS: 本文は解説用。実際の計算UIは toolId で対応するAstroコンポーネントを紐付ける想定。
const tools = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/tools' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    publishDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
    featured: z.boolean().default(false),
    toolId: z.string(),
  }),
});

export const collections = { articles, dataLab, tools };
