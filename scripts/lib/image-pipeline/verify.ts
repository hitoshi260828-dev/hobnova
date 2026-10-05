import fs from 'node:fs';
import path from 'node:path';
import type { ArticleFile } from './article-file';

// astro:assetsのimage()が実際に扱える拡張子。ここに無い拡張子はビルド時に失敗するため、
// 事前チェックの段階で検出する。
const SUPPORTED_IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'avif', 'svg', 'gif']);

export interface CoverVerificationResult {
  /** frontmatterにcoverが設定されているか（未設定自体はエラーではない） */
  present: boolean;
  ok: boolean;
  errors: string[];
}

/**
 * frontmatterのcoverが実ファイルとして存在し、サイズ > 0 で、astro:assetsが扱える
 * 拡張子であることを確認する。Astroの image() 自体が最終的に解決できるかどうかは、
 * このチェックの後段で実行する astro check / build が検証する。
 */
export function verifyCoverImage(article: ArticleFile): CoverVerificationResult {
  const image = article.data.image;
  if (typeof image !== 'string' || image.trim() === '') {
    return { present: false, ok: true, errors: [] };
  }

  const errors: string[] = [];
  const resolved = path.resolve(article.articleDir, image);
  const ext = path.extname(resolved).slice(1).toLowerCase();

  if (!fs.existsSync(resolved)) {
    errors.push(`cover画像ファイルが存在しません: ${resolved}`);
  } else if (fs.statSync(resolved).size <= 0) {
    errors.push(`cover画像ファイルサイズが0です: ${resolved}`);
  }

  if (!SUPPORTED_IMAGE_EXTENSIONS.has(ext)) {
    errors.push(`cover画像の拡張子がastro:assetsで未対応です: .${ext}`);
  }

  return { present: true, ok: errors.length === 0, errors };
}

export interface InlineImageCheckTarget {
  /** 実ファイルの絶対パス */
  targetPath: string;
  /** Markdown本文から参照する際のパス（例: /images/articles/slug/inline-01.jpg） */
  referencePath: string;
}

export interface InlineVerificationResult {
  ok: boolean;
  errors: string[];
}

/**
 * 生成・取り込み済みのinline画像について、実ファイル存在・本文からの参照の有無・
 * 二重挿入が無いことを確認する。
 */
export function verifyInlineImages(article: ArticleFile, images: InlineImageCheckTarget[]): InlineVerificationResult {
  const errors: string[] = [];

  for (const image of images) {
    if (!fs.existsSync(image.targetPath)) {
      errors.push(`inline画像ファイルが存在しません: ${image.targetPath}`);
    } else if (fs.statSync(image.targetPath).size <= 0) {
      errors.push(`inline画像ファイルサイズが0です: ${image.targetPath}`);
    }

    const marker = `](${image.referencePath})`;
    const occurrences = article.body.split(marker).length - 1;
    if (occurrences === 0) {
      errors.push(`本文にinline画像の参照がありません: ${image.referencePath}`);
    } else if (occurrences > 1) {
      errors.push(`inline画像が本文に二重挿入されています: ${image.referencePath}`);
    }
  }

  return { ok: errors.length === 0, errors };
}
