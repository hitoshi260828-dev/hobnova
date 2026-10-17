// 本文（inline）画像のMarkdown挿入ユーティリティ。
//
// アルゴリズムは scripts/lib/image-pipeline/{sections,markdown-insert}.ts と同一だが、
// それらはNode（gray-matter等）前提のためCloudflare Workersランタイムへ直接importできない。
// 必要な最小限（H2見出し検出・挿入位置決定・二重挿入防止）だけをここへ移植する。
const H2_PATTERN = /^##\s+(.+)$/gm;

export interface HeadingMatch {
  heading: string;
  headingEndIndex: number;
}

/** Markdown本文（frontmatter込みの全文でもよい。`##`行はYAML内に現れない前提）からH2見出しを列挙する。 */
export function findHeadings(source: string): HeadingMatch[] {
  const matches = [...source.matchAll(H2_PATTERN)];
  return matches.map((m) => ({ heading: m[1].trim(), headingEndIndex: (m.index ?? 0) + m[0].length }));
}

export interface ResolvedPosition {
  heading: string;
  headingEndIndex: number;
}

export function resolveInsertPosition(
  source: string,
  options: { afterHeading?: string; position?: number }
): ResolvedPosition | { error: string } {
  const headings = findHeadings(source);

  if (options.afterHeading) {
    const found = headings.find((h) => h.heading === options.afterHeading);
    if (!found) return { error: `見出しが見つかりません: ${options.afterHeading}` };
    return found;
  }

  if (options.position !== undefined) {
    const idx = options.position - 1;
    if (!Number.isInteger(idx) || idx < 0 || idx >= headings.length) {
      return { error: `position が不正です（1〜${headings.length}の範囲で指定してください）: ${options.position}` };
    }
    return headings[idx];
  }

  return { error: 'after_heading または position のどちらかが必要です' };
}

/** 同じ参照パスが本文へ既に挿入済みかどうか（二重挿入防止の最終チェック）。 */
export function isAlreadyInserted(source: string, referencePath: string): boolean {
  return source.includes(`](${referencePath})`);
}

export function insertInlineImage(source: string, headingEndIndex: number, alt: string, referencePath: string): string {
  const markdown = `\n\n![${alt}](${referencePath})\n`;
  return source.slice(0, headingEndIndex) + markdown + source.slice(headingEndIndex);
}
