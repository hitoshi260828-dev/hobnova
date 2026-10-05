import fs from 'node:fs';
import path from 'node:path';

import { ensureDir, publicInlineImageDir, writeArticleFile, type ArticleFile } from './article-file';
import { generateCoverImage, resolveOpenAiImageModel } from './openai-cover';
import {
  generateInlineImage,
  resolveCloudflareImageGuidance,
  resolveCloudflareImageModel,
  resolveCloudflareImageSteps,
} from './cloudflare-inline';
import { insertInlineImages } from './markdown-insert';
import type { ImagePlan } from './plan';

export interface CoverRunResult {
  status: 'success' | 'failed' | 'skipped' | 'not-planned';
  targetPath?: string;
  reason?: string;
  error?: string;
}

export interface InlineImageOutcome {
  heading: string;
  status: 'success' | 'failed';
  targetPath?: string;
  referencePath?: string;
  error?: string;
}

export interface InlineRunResult {
  status: 'success' | 'partial' | 'failed' | 'skipped' | 'not-planned';
  reason?: string;
  succeeded: number;
  failed: number;
  outcomes: InlineImageOutcome[];
}

export interface ImageGenerationRunResult {
  cover: CoverRunResult;
  inline: InlineRunResult;
  /** frontmatter/Markdownを実際に書き換えたか（生成成功が1件以上あった場合のみtrue） */
  articleUpdated: boolean;
}

/**
 * buildImagePlan() が作った計画を実行する（実API呼び出し・ファイル保存・frontmatter/Markdown更新）。
 * scripts/generate-article-images.ts と scripts/run-daily-article-pipeline.ts の両方が、
 * この関数を共有して画像生成パイプラインを実行する（ロジックの重複実装を避けるため）。
 *
 * 1枚の画像生成に失敗しても他の画像生成は続行し、成功した分だけ記事へ反映する
 * （途中成功分を失わない）。
 */
export async function runImageGenerationPlan(
  article: ArticleFile,
  repoRoot: string,
  plan: ImagePlan
): Promise<ImageGenerationRunResult> {
  let coverSucceeded = false;
  let cover: CoverRunResult;

  if (!plan.coverItem) {
    cover = plan.skippedCoverReason
      ? { status: 'skipped', reason: plan.skippedCoverReason }
      : { status: 'not-planned' };
  } else {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      cover = { status: 'failed', error: 'OPENAI_API_KEY が未設定のため、アイキャッチ生成をスキップしました。' };
    } else {
      try {
        const model = resolveOpenAiImageModel();
        const { buffer, ext } = await generateCoverImage(plan.coverItem.prompt, { apiKey, model });
        const targetPath = plan.coverItem.targetPath.replace(/\.png$/, `.${ext}`);
        fs.writeFileSync(targetPath, buffer);
        article.data.image = `./${path.basename(targetPath)}`;
        coverSucceeded = true;
        cover = { status: 'success', targetPath };
      } catch (err) {
        cover = { status: 'failed', error: (err as Error).message };
      }
    }
  }

  const insertions: Array<{ headingEndIndex: number; alt: string; referencePath: string }> = [];
  let inline: InlineRunResult;

  if (plan.inlineItems.length === 0) {
    inline = plan.skippedInlineReason
      ? { status: 'skipped', reason: plan.skippedInlineReason, succeeded: 0, failed: 0, outcomes: [] }
      : { status: 'not-planned', succeeded: 0, failed: 0, outcomes: [] };
  } else {
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    const apiToken = process.env.CLOUDFLARE_API_TOKEN;
    const outcomes: InlineImageOutcome[] = [];

    if (!accountId || !apiToken) {
      const reason = 'CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN が未設定のため、本文画像生成をスキップしました。';
      for (const item of plan.inlineItems) {
        outcomes.push({ heading: item.heading ?? '', status: 'failed', error: reason });
      }
      // 全件が同一理由（認証情報未設定）のため、reasonへ1件だけ記録する
      // （CLIは outcomes を1件ずつ表示する代わりにこのreasonを1行だけ表示できる）。
      inline = { status: 'failed', reason, succeeded: 0, failed: outcomes.length, outcomes };
    } else {
      const model = resolveCloudflareImageModel();
      const guidance = resolveCloudflareImageGuidance();
      const steps = resolveCloudflareImageSteps();
      const inlineDir = publicInlineImageDir(repoRoot, article.slug);
      ensureDir(inlineDir);

      for (let i = 0; i < plan.inlineItems.length; i++) {
        const item = plan.inlineItems[i];
        const selected = plan.selectedSections[i];
        try {
          const { buffer, ext } = await generateInlineImage(item.prompt, {
            accountId,
            apiToken,
            model,
            width: 1024,
            height: 1024,
            guidance,
            steps,
          });
          const fileName = path.basename(item.targetPath).replace(/\.jpg$/, `.${ext}`);
          const absoluteTarget = path.join(inlineDir, fileName);
          fs.writeFileSync(absoluteTarget, buffer);

          const referencePath = `/images/articles/${article.slug}/${fileName}`;
          insertions.push({ headingEndIndex: selected.section.headingEndIndex, alt: item.alt ?? '', referencePath });
          outcomes.push({ heading: item.heading ?? '', status: 'success', targetPath: absoluteTarget, referencePath });
        } catch (err) {
          outcomes.push({ heading: item.heading ?? '', status: 'failed', error: (err as Error).message });
        }
      }

      const succeeded = outcomes.filter((o) => o.status === 'success').length;
      const failed = outcomes.filter((o) => o.status === 'failed').length;
      inline = {
        status: succeeded === 0 ? 'failed' : failed === 0 ? 'success' : 'partial',
        succeeded,
        failed,
        outcomes,
      };
    }
  }

  // Markdown更新は、生成が成功したものだけを反映する。
  if (insertions.length > 0) {
    article.body = insertInlineImages(article.body, insertions);
  }

  const articleUpdated = coverSucceeded || insertions.length > 0;
  if (articleUpdated) {
    writeArticleFile(article);
  }

  return { cover, inline, articleUpdated };
}
