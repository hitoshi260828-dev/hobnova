import fs from 'node:fs';
import path from 'node:path';
import type { ArticleFile } from './article-file';
import { ensureDir, hasExistingCover, nextInlineIndex, publicInlineImageDir, writeArticleFile } from './article-file';
import { parseSections } from './sections';
import { insertInlineImages, isAlreadyInserted } from './markdown-insert';

export interface ImportResult {
  kind: 'cover' | 'inline';
  targetPath: string;
  referencePath?: string;
  alt?: string;
  index?: number;
  skipped: boolean;
  skippedReason?: string;
  copyOnly: boolean;
}

function buildAutoAlt(articleTitle: string, heading: string): string {
  // 見出しをそのまま「〜について」等に直結すると動詞終わりの見出しで不自然になるため、
  // 鉤括弧で独立させて「〜を示す画像」という定型句につなげる（既存のgenerateAltText等と
  // 同じ考え方）。
  const quotedHeading = `「${heading.replace(/[「」]/g, '')}」`;
  return `${quotedHeading}を示す画像（${articleTitle}）`;
}

/** 既存ファイルを安全に削除する（ロールバック用。失敗しても例外を投げず警告のみ）。 */
function safeUnlink(targetPath: string): void {
  try {
    if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
  } catch {
    console.warn(`[WARN] ロールバックに失敗しました。手動で削除してください: ${targetPath}`);
  }
}

export interface ImportCoverOptions {
  article: ArticleFile;
  buffer: Buffer;
  ext: string;
  force: boolean;
  dryRun: boolean;
  copyOnly: boolean;
}

export function planImportCover(article: ArticleFile, ext: string, force: boolean) {
  const targetPath = path.join(article.articleDir, `${article.slug}-hero.${ext}`);
  if (hasExistingCover(article) && !force) {
    return {
      targetPath,
      skip: true,
      skippedReason: '既存のアイキャッチ画像が存在するためスキップ（--force で上書き可）',
    };
  }
  return { targetPath, skip: false, skippedReason: undefined as string | undefined };
}

export function importCover(options: ImportCoverOptions): ImportResult {
  const { article, buffer, ext, force, dryRun, copyOnly } = options;
  const plan = planImportCover(article, ext, force);

  if (plan.skip) {
    return { kind: 'cover', targetPath: plan.targetPath, skipped: true, skippedReason: plan.skippedReason, copyOnly };
  }
  if (dryRun) {
    return { kind: 'cover', targetPath: plan.targetPath, skipped: false, copyOnly };
  }

  // --force で拡張子違いの新しい画像に差し替える場合、古いファイルが孤立して残らないよう、
  // 新ファイル書き込み成功後に削除する（frontmatterが新しいパスを指すようになった後なので、
  // 既に参照されていない旧ファイルを消すだけで安全）。
  const previousImage = typeof article.data.image === 'string' ? article.data.image : undefined;
  const previousImagePath = previousImage ? path.resolve(article.articleDir, previousImage) : undefined;

  ensureDir(path.dirname(plan.targetPath));
  fs.writeFileSync(plan.targetPath, buffer);

  if (copyOnly) {
    return { kind: 'cover', targetPath: plan.targetPath, skipped: false, copyOnly: true };
  }

  try {
    article.data.image = `./${path.basename(plan.targetPath)}`;
    writeArticleFile(article);
  } catch (err) {
    article.data.image = previousImage;
    safeUnlink(plan.targetPath);
    throw err;
  }

  // 新しいcoverの書き込み・frontmatter更新が両方成功した後にのみ、古いファイルを削除する。
  if (previousImagePath && previousImagePath !== plan.targetPath) {
    safeUnlink(previousImagePath);
  }

  return { kind: 'cover', targetPath: plan.targetPath, skipped: false, copyOnly: false };
}

export interface ResolveInlineTargetOptions {
  article: ArticleFile;
  repoRoot: string;
  ext: string;
  afterHeading?: string;
  position?: number;
  alt?: string;
}

export interface InlineTargetResolution {
  index: number;
  targetPath: string;
  referencePath: string;
  headingEndIndex: number;
  resolvedHeading: string;
  alt: string;
}

export function resolveInlineTarget(options: ResolveInlineTargetOptions): InlineTargetResolution {
  const { article, repoRoot, ext, afterHeading, position, alt } = options;
  const sections = parseSections(article.body);

  let matchedSection;
  if (afterHeading) {
    matchedSection = sections.find((s) => s.heading === afterHeading);
    if (!matchedSection) {
      throw new Error(`見出しが見つかりません: "${afterHeading}"`);
    }
  } else if (position !== undefined) {
    if (position < 1 || position > sections.length) {
      throw new Error(`--position が不正です（この記事は1〜${sections.length}の範囲で指定してください）: ${position}`);
    }
    matchedSection = sections[position - 1];
  } else {
    throw new Error('--after-heading または --position のいずれかを指定してください');
  }

  const index = nextInlineIndex(repoRoot, article.slug);
  const fileName = `inline-${String(index).padStart(2, '0')}.${ext}`;
  const targetPath = path.join(publicInlineImageDir(repoRoot, article.slug), fileName);
  const referencePath = `/images/articles/${article.slug}/${fileName}`;

  const resolvedAlt =
    alt && alt.trim().length > 0
      ? alt.trim()
      : buildAutoAlt(String(article.data.title ?? article.slug), matchedSection.heading);

  return {
    index,
    targetPath,
    referencePath,
    headingEndIndex: matchedSection.headingEndIndex,
    resolvedHeading: matchedSection.heading,
    alt: resolvedAlt,
  };
}

export interface ImportInlineOptions {
  article: ArticleFile;
  repoRoot: string;
  buffer: Buffer;
  ext: string;
  afterHeading?: string;
  position?: number;
  alt?: string;
  force: boolean;
  dryRun: boolean;
  copyOnly: boolean;
}

export function importInline(options: ImportInlineOptions): ImportResult {
  const { article, repoRoot, buffer, ext, afterHeading, position, alt, force, dryRun, copyOnly } = options;
  const resolution = resolveInlineTarget({ article, repoRoot, ext, afterHeading, position, alt });

  if (isAlreadyInserted(article.body, resolution.referencePath) && !force) {
    return {
      kind: 'inline',
      targetPath: resolution.targetPath,
      referencePath: resolution.referencePath,
      alt: resolution.alt,
      index: resolution.index,
      skipped: true,
      skippedReason: 'この画像パスは既に本文へ挿入済みです（--force で強制挿入可）',
      copyOnly,
    };
  }

  if (dryRun) {
    return {
      kind: 'inline',
      targetPath: resolution.targetPath,
      referencePath: resolution.referencePath,
      alt: resolution.alt,
      index: resolution.index,
      skipped: false,
      copyOnly,
    };
  }

  ensureDir(path.dirname(resolution.targetPath));
  fs.writeFileSync(resolution.targetPath, buffer);

  if (copyOnly) {
    return {
      kind: 'inline',
      targetPath: resolution.targetPath,
      referencePath: resolution.referencePath,
      alt: resolution.alt,
      index: resolution.index,
      skipped: false,
      copyOnly: true,
    };
  }

  const previousBody = article.body;
  try {
    article.body = insertInlineImages(article.body, [
      { headingEndIndex: resolution.headingEndIndex, alt: resolution.alt, referencePath: resolution.referencePath },
    ]);
    writeArticleFile(article);
  } catch (err) {
    article.body = previousBody;
    safeUnlink(resolution.targetPath);
    throw err;
  }

  return {
    kind: 'inline',
    targetPath: resolution.targetPath,
    referencePath: resolution.referencePath,
    alt: resolution.alt,
    index: resolution.index,
    skipped: false,
    copyOnly: false,
  };
}
