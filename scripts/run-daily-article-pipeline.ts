#!/usr/bin/env -S npx tsx
// 記事Markdown確定後に、画像生成（OpenAI cover + Cloudflare inline）→ astro check → build →
// git diff確認までを1本にまとめて実行するCLI。PR作成自体は行わない
// （既存のPR作成運用: docs/ai-article-guidelines.md 9章 に従い、人間またはPRを作成する側の
// エージェントが別途行う）。
//
// Usage:
//   npm run article:pipeline -- path/to/article.md [--dry-run] [--force] [--cover-only] [--inline-only]
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseArgs } from './lib/image-pipeline/cli-args';
import { runDailyArticlePipeline } from './lib/image-pipeline/daily-pipeline';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ローカル実行用。CIではGitHub Secretsが直接 process.env に注入されるため、
// .env.local が無くてもエラーにしない。
try {
  process.loadEnvFile(path.join(REPO_ROOT, '.env.local'));
} catch {
  // ファイルが無い場合は何もしない（CI / 未設定ローカルの両方で正常）。
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  console.log('[ARTICLE PIPELINE]');
  console.log(`Article: ${options.articlePath}`);

  const result = await runDailyArticlePipeline({
    articlePath: options.articlePath,
    repoRoot: REPO_ROOT,
    dryRun: options.dryRun,
    force: options.force,
    coverOnly: options.coverOnly,
    inlineOnly: options.inlineOnly,
  });

  console.log(`Draft: ${result.draft}`);
  console.log(`Cover: ${result.plan.coverItem ? 'generate' : result.plan.skippedCoverReason ? 'skip' : 'none'}`);
  console.log(`Inline: ${result.plan.inlineItems.length}`);

  if (options.dryRun) {
    console.log('Astro check: skipped (dry-run)');
    console.log('Build: skipped (dry-run)');
    console.log('PR: skipped (dry-run)');
    console.log('\n--dry-run のため、API呼び出し・ファイル書き換え・astro check/build・PR作成は行っていません。');

    if (result.plan.coverItem) {
      console.log(`[cover] -> ${result.plan.coverItem.targetPath}`);
    } else if (result.plan.skippedCoverReason) {
      console.log(`[cover] skip: ${result.plan.skippedCoverReason}`);
    }
    for (const item of result.plan.inlineItems) {
      console.log(`[inline] "${item.heading}" -> ${item.targetPath}`);
    }
    if (result.plan.skippedInlineReason) {
      console.log(`[inline] skip: ${result.plan.skippedInlineReason}`);
    }
    return;
  }

  console.log('Astro check: pending');
  console.log('Build: pending');
  console.log('PR: pending');

  console.log('\n[RESULT]');

  const coverStatus = result.generation?.cover.status ?? 'not-planned';
  console.log(`Cover: ${coverStatus}`);
  if (result.generation?.cover.error) {
    console.warn(`  [WARN] ${result.generation.cover.error}`);
  }

  const inlineSucceeded = result.generation?.inline.succeeded ?? 0;
  const inlineFailed = result.generation?.inline.failed ?? 0;
  console.log(`Inline: ${inlineSucceeded} success / ${inlineFailed} failed`);
  if (result.generation?.inline.reason) {
    // 全件共通の理由（認証情報未設定等）は1行だけ表示する（outcomes分の重複表示を避ける）。
    console.warn(`  [WARN] ${result.generation.inline.reason}`);
  } else {
    for (const outcome of result.generation?.inline.outcomes ?? []) {
      if (outcome.status === 'failed') {
        console.warn(`  [WARN] "${outcome.heading}": ${outcome.error}`);
      }
    }
  }

  console.log(`Astro check: ${result.astroCheck.status}`);
  if (result.astroCheck.status === 'fail') {
    console.warn(result.astroCheck.output);
  }

  console.log(`Build: ${result.build.status}`);
  if (result.build.status === 'fail') {
    console.warn(result.build.output);
  }

  if (result.verification) {
    if (!result.verification.cover.ok) {
      console.warn(`[WARN] cover品質チェック: ${result.verification.cover.errors.join(' / ')}`);
    }
    if (!result.verification.inline.ok) {
      console.warn(`[WARN] inline品質チェック: ${result.verification.inline.errors.join(' / ')}`);
    }
  }

  const criticalFailure = result.astroCheck.status === 'fail' || result.build.status === 'fail';
  console.log(`PR: ${criticalFailure ? 'skipped (astro check / build が失敗したため)' : 'ready（PR作成は既存の運用フローで別途実行してください）'}`);

  if (result.gitStatus !== null) {
    console.log('\n--- git status (記事・画像の差分) ---');
    console.log(result.gitStatus.trim() || '(差分なし)');
  }

  if (criticalFailure) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(`[ERROR] ${(err as Error).message}`);
  process.exitCode = 1;
});
