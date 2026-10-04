#!/usr/bin/env -S npx tsx
// 記事のアイキャッチ（OpenAI Image API）と本文画像（Cloudflare Workers AI）を
// 自動生成し、既存のAstroプロジェクト内へ保存・Markdownへ自動挿入するCLI。
//
// Usage:
//   npm run images:generate -- path/to/article.md [--dry-run] [--force] [--cover-only] [--inline-only]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ensureDir,
  hasExistingCover,
  hasExistingInlineImages,
  loadArticleFile,
  publicInlineImageDir,
  writeArticleFile,
  type ArticleFile,
} from './lib/image-pipeline/article-file';
import { buildImagePlan } from './lib/image-pipeline/plan';
import { generateCoverImage, resolveOpenAiImageModel } from './lib/image-pipeline/openai-cover';
import { generateInlineImage, resolveCloudflareImageModel } from './lib/image-pipeline/cloudflare-inline';
import { insertInlineImages } from './lib/image-pipeline/markdown-insert';
import { parseArgs } from './lib/image-pipeline/cli-args';
import type { PlanItem } from './lib/image-pipeline/types';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ローカル実行用。CIではGitHub Secretsが直接 process.env に注入されるため、
// .env.local が無くてもエラーにしない。
try {
  process.loadEnvFile(path.join(REPO_ROOT, '.env.local'));
} catch {
  // ファイルが無い場合は何もしない（CI / 未設定ローカルの両方で正常）。
}

function printPlan(article: ArticleFile, items: { coverItem: PlanItem | null; inlineItems: PlanItem[] }) {
  console.log('--- 生成予定 ---');
  if (items.coverItem) {
    console.log(`[cover] -> ${items.coverItem.targetPath}`);
    console.log(`  prompt: ${items.coverItem.prompt.replace(/\n/g, ' ').slice(0, 200)}...`);
  }
  for (const item of items.inlineItems) {
    console.log(`[inline] "${item.heading}" -> ${item.targetPath}`);
    console.log(`  alt: ${item.alt}`);
    console.log(`  prompt: ${item.prompt.replace(/\n/g, ' ').slice(0, 200)}...`);
  }
  if (!items.coverItem && items.inlineItems.length === 0) {
    console.log('(生成対象なし)');
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const article = loadArticleFile(options.articlePath);

  const existingCover = hasExistingCover(article);
  const existingInline = hasExistingInlineImages(REPO_ROOT, article.slug);

  const plan = buildImagePlan({
    article,
    coverOnly: options.coverOnly,
    inlineOnly: options.inlineOnly,
    hasExistingCover: existingCover,
    hasExistingInlineImages: existingInline,
    force: options.force,
  });

  console.log('[IMAGE]');
  console.log(`Article: ${article.slug}`);
  console.log(`Cover: ${plan.coverItem ? 1 : 0}`);
  console.log(`Inline: ${plan.inlineItems.length}`);
  console.log('Provider: OpenAI / Cloudflare');
  if (plan.skippedCoverReason) console.log(`Cover skipped: ${plan.skippedCoverReason}`);
  if (plan.skippedInlineReason) console.log(`Inline skipped: ${plan.skippedInlineReason}`);

  if (options.dryRun) {
    printPlan(article, plan);
    console.log('\n--dry-run のためAPI呼び出しは行っていません。');
    return;
  }

  let coverSucceeded = false;

  if (plan.coverItem) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.warn('[WARN] OPENAI_API_KEY が未設定のため、アイキャッチ生成をスキップします。');
    } else {
      try {
        const model = resolveOpenAiImageModel();
        const { buffer, ext } = await generateCoverImage(plan.coverItem.prompt, { apiKey, model });
        const targetPath = plan.coverItem.targetPath.replace(/\.png$/, `.${ext}`);
        fs.writeFileSync(targetPath, buffer);
        article.data.image = `./${path.basename(targetPath)}`;
        coverSucceeded = true;
        console.log(`[cover] 生成成功: ${targetPath}`);
      } catch (err) {
        console.warn(`[WARN] アイキャッチ生成に失敗しました（本文画像生成は続行します）: ${(err as Error).message}`);
      }
    }
  }

  const insertions: Array<{ headingEndIndex: number; alt: string; referencePath: string }> = [];

  if (plan.inlineItems.length > 0) {
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    const apiToken = process.env.CLOUDFLARE_API_TOKEN;

    if (!accountId || !apiToken) {
      console.warn('[WARN] CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN が未設定のため、本文画像生成をスキップします。');
    } else {
      const model = resolveCloudflareImageModel();
      const inlineDir = publicInlineImageDir(REPO_ROOT, article.slug);
      ensureDir(inlineDir);

      for (let i = 0; i < plan.inlineItems.length; i++) {
        const item = plan.inlineItems[i];
        const selected = plan.selectedSections[i];
        try {
          const { buffer, ext } = await generateInlineImage(item.prompt, { accountId, apiToken, model });
          const fileName = path.basename(item.targetPath).replace(/\.jpg$/, `.${ext}`);
          const absoluteTarget = path.join(inlineDir, fileName);
          fs.writeFileSync(absoluteTarget, buffer);

          const referencePath = `/images/articles/${article.slug}/${fileName}`;
          insertions.push({
            headingEndIndex: selected.section.headingEndIndex,
            alt: item.alt ?? '',
            referencePath,
          });
          console.log(`[inline] 生成成功: "${item.heading}" -> ${absoluteTarget}`);
        } catch (err) {
          console.warn(`[WARN] 本文画像の生成に失敗しました（"${item.heading}"、他の画像生成は続行します）: ${(err as Error).message}`);
        }
      }
    }
  }

  // Markdown更新は、生成が成功したものだけを反映する。
  if (insertions.length > 0) {
    article.body = insertInlineImages(article.body, insertions);
  }

  if (coverSucceeded || insertions.length > 0) {
    writeArticleFile(article);
    console.log(`\n記事ファイルを更新しました: ${article.absolutePath}`);
  } else {
    console.log('\n生成に成功した画像がなかったため、記事ファイルは変更していません。');
  }
}

main().catch((err) => {
  console.error(`[ERROR] ${(err as Error).message}`);
  process.exitCode = 1;
});
