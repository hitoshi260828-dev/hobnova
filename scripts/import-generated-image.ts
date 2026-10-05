#!/usr/bin/env -S npx tsx
// ChatGPT等で生成済みの画像（ローカルファイル）を、HOBNOVAの記事へ取り込むCLI。
// OpenAI/Cloudflareの画像生成APIは一切呼び出さない（scripts/generate-article-images.ts とは独立）。
//
// Usage:
//   npm run images:import -- --article path/to/article.md --image path/to/image.png --type cover
//   npm run images:import -- --article path/to/article.md --image path/to/image.png --type inline \
//     --after-heading "見出しテキスト"
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadArticleFile } from './lib/image-pipeline/article-file';
import { createLocalFileSource, resolveImageSource } from './lib/image-pipeline/import-source';
import { importCover, importInline, planImportCover, resolveInlineTarget } from './lib/image-pipeline/import-image';
import { parseImportArgs } from './lib/image-pipeline/import-cli-args';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function main() {
  const options = parseImportArgs(process.argv.slice(2));
  const article = loadArticleFile(options.articlePath);
  const { buffer, ext } = await resolveImageSource(createLocalFileSource(options.imagePath));

  console.log('[IMPORT]');
  console.log(`Article: ${article.slug}`);
  console.log(`Type: ${options.type}`);
  console.log(`Source: ${path.resolve(process.cwd(), options.imagePath)} (.${ext})`);
  if (options.copyOnly) console.log('Mode: copy-only（記事側は更新しません）');
  if (options.dryRun) console.log('Mode: dry-run（一切書き換えません）');

  if (options.type === 'cover') {
    if (options.dryRun) {
      const plan = planImportCover(article, ext, options.force);
      console.log(`[cover] -> ${plan.targetPath}`);
      if (plan.skip) console.log(`  skip: ${plan.skippedReason}`);
      return;
    }

    const result = importCover({ article, buffer, ext, force: options.force, dryRun: false, copyOnly: options.copyOnly });
    if (result.skipped) {
      console.log(`[cover] スキップ: ${result.skippedReason}`);
      return;
    }
    console.log(`[cover] ${result.copyOnly ? 'コピー完了（記事未更新）' : '取り込み成功'}: ${result.targetPath}`);
    return;
  }

  // inline
  if (options.dryRun) {
    const resolution = resolveInlineTarget({
      article,
      repoRoot: REPO_ROOT,
      ext,
      afterHeading: options.afterHeading,
      position: options.position,
      alt: options.alt,
    });
    console.log(`[inline] "${resolution.resolvedHeading}" -> ${resolution.targetPath}`);
    console.log(`  reference: ${resolution.referencePath}`);
    console.log(`  alt: ${resolution.alt}`);
    return;
  }

  const result = importInline({
    article,
    repoRoot: REPO_ROOT,
    buffer,
    ext,
    afterHeading: options.afterHeading,
    position: options.position,
    alt: options.alt,
    force: options.force,
    dryRun: false,
    copyOnly: options.copyOnly,
  });

  if (result.skipped) {
    console.log(`[inline] スキップ: ${result.skippedReason}`);
    return;
  }
  console.log(`[inline] ${result.copyOnly ? 'コピー完了(記事未更新)' : '取り込み成功'}: ${result.targetPath}`);
  if (!result.copyOnly) {
    console.log(`  reference: ${result.referencePath}`);
    console.log(`  alt: ${result.alt}`);
  }
}

main().catch((err) => {
  console.error(`[ERROR] ${(err as Error).message}`);
  process.exitCode = 1;
});
