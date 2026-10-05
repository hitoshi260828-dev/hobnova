#!/usr/bin/env -S npx tsx
// 記事のアイキャッチ（OpenAI Image API）と本文画像（Cloudflare Workers AI）を
// 自動生成し、既存のAstroプロジェクト内へ保存・Markdownへ自動挿入するCLI。
//
// Usage:
//   npm run images:generate -- path/to/article.md [--dry-run] [--force] [--cover-only] [--inline-only]
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { hasExistingCover, hasExistingInlineImages, loadArticleFile, type ArticleFile } from './lib/image-pipeline/article-file';
import { buildImagePlan } from './lib/image-pipeline/plan';
import { runImageGenerationPlan } from './lib/image-pipeline/run-image-generation';
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
    if (items.coverItem.copy) {
      console.log(`  copy: ${items.coverItem.copy.line1} / ${items.coverItem.copy.line2}`);
    }
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

  const result = await runImageGenerationPlan(article, REPO_ROOT, plan);

  if (result.cover.status === 'success') {
    console.log(`[cover] 生成成功: ${result.cover.targetPath}`);
  } else if (result.cover.status === 'failed' && result.cover.error) {
    console.warn(`[WARN] アイキャッチ生成に失敗しました（本文画像生成は続行します）: ${result.cover.error}`);
  }

  if (result.inline.reason) {
    // 全件共通の理由（認証情報未設定等）は1行だけ表示する（outcomes分の重複表示を避ける）。
    console.warn(`[WARN] 本文画像生成をスキップしました: ${result.inline.reason}`);
  } else {
    for (const outcome of result.inline.outcomes) {
      if (outcome.status === 'success') {
        console.log(`[inline] 生成成功: "${outcome.heading}" -> ${outcome.targetPath}`);
      } else {
        console.warn(`[WARN] 本文画像の生成に失敗しました（"${outcome.heading}"、他の画像生成は続行します）: ${outcome.error}`);
      }
    }
  }

  if (result.articleUpdated) {
    console.log(`\n記事ファイルを更新しました: ${article.absolutePath}`);
  } else {
    console.log('\n生成に成功した画像がなかったため、記事ファイルは変更していません。');
  }
}

main().catch((err) => {
  console.error(`[ERROR] ${(err as Error).message}`);
  process.exitCode = 1;
});
