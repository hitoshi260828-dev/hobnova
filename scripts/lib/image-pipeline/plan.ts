import path from 'node:path';
import type { ArticleFile } from './article-file';
import { parseSections, selectSectionsForImages, targetInlineImageCount } from './sections';
import { buildCoverPrompt, buildInlineImagePrompt, generateAltText, summarizeSectionForPrompt } from './prompts';
import { buildCoverCopy } from './cover-copy';
import type { PlanItem, SelectedSection } from './types';

export interface BuildPlanOptions {
  article: ArticleFile;
  coverOnly: boolean;
  inlineOnly: boolean;
  hasExistingCover: boolean;
  hasExistingInlineImages: boolean;
  force: boolean;
}

export interface ImagePlan {
  coverItem: PlanItem | null;
  inlineItems: PlanItem[];
  selectedSections: SelectedSection[];
  skippedCoverReason: string | null;
  skippedInlineReason: string | null;
}

/**
 * 記事内容から、生成する画像の計画（プロンプト・保存先・alt）を作る。
 * API呼び出しは一切行わない（--dry-run はこの関数の出力をそのまま表示するだけでよい設計）。
 */
export function buildImagePlan(options: BuildPlanOptions): ImagePlan {
  const { article, coverOnly, inlineOnly, hasExistingCover, hasExistingInlineImages, force } = options;

  const wantCover = !inlineOnly;
  const wantInline = !coverOnly;

  let coverItem: PlanItem | null = null;
  let skippedCoverReason: string | null = null;

  if (wantCover) {
    if (hasExistingCover && !force) {
      skippedCoverReason = '既存のアイキャッチ画像が存在するためスキップ（--force で再生成可）';
    } else {
      const title = String(article.data.title ?? article.slug);
      const description = String(article.data.description ?? '');
      const category = String(article.data.category ?? '');
      const bodyExcerpt = summarizeSectionForPrompt(article.body, 500);
      const copy = buildCoverCopy(title, description);

      coverItem = {
        kind: 'cover',
        targetPath: path.join(article.articleDir, `${article.slug}-hero.png`),
        prompt: buildCoverPrompt({
          title,
          description,
          category,
          // 「主要結論」はLLM要約を追加で呼ばず、既に人間が書いたdescriptionを根拠として使う。
          mainTakeaway: description,
          bodyExcerpt,
          copy,
        }),
        copy,
      };
    }
  }

  let inlineItems: PlanItem[] = [];
  let selectedSections: SelectedSection[] = [];
  let skippedInlineReason: string | null = null;

  if (wantInline) {
    if (hasExistingInlineImages && !force) {
      skippedInlineReason = '既存の本文画像が存在するためスキップ（--force で再生成可）';
    } else {
      const sections = parseSections(article.body);
      const maxCount = targetInlineImageCount(article.body.length);
      selectedSections = selectSectionsForImages(sections, maxCount);

      inlineItems = selectedSections.map((selected, i) => {
        const index = String(i + 1).padStart(2, '0');
        const alt = generateAltText(selected);
        return {
          kind: 'inline',
          targetPath: `public/images/articles/${article.slug}/inline-${index}.jpg`,
          prompt: buildInlineImagePrompt({
            articleTitle: String(article.data.title ?? article.slug),
            section: selected,
            sectionSummary: summarizeSectionForPrompt(selected.section.body),
          }),
          alt,
          heading: selected.section.heading,
        };
      });

      if (inlineItems.length === 0) {
        skippedInlineReason = '画像を入れる効果が高いセクションが見つからなかったため生成なし';
      }
    }
  }

  return { coverItem, inlineItems, selectedSections, skippedCoverReason, skippedInlineReason };
}
