export interface InlineInsertion {
  /** セクション本文（見出し直後）に挿入する文字インデックス */
  headingEndIndex: number;
  alt: string;
  /** サイトから参照する絶対パス（例: /images/articles/slug/inline-01.jpg） */
  referencePath: string;
}

/**
 * 本文（frontmatterを除いたMarkdown）へ、指定位置にMarkdown画像記法を挿入する。
 * 複数挿入時にインデックスがずれないよう、文字インデックスが大きい方から順に処理する。
 */
export function insertInlineImages(body: string, insertions: InlineInsertion[]): string {
  const sorted = [...insertions].sort((a, b) => b.headingEndIndex - a.headingEndIndex);
  let result = body;

  for (const insertion of sorted) {
    const markdown = `\n\n![${insertion.alt}](${insertion.referencePath})\n`;
    result = result.slice(0, insertion.headingEndIndex) + markdown + result.slice(insertion.headingEndIndex);
  }

  return result;
}

/** 既にこの画像パスが本文へ挿入済みかどうか（二重挿入防止の最終チェック）。 */
export function isAlreadyInserted(body: string, referencePath: string): boolean {
  return body.includes(`](${referencePath})`);
}
