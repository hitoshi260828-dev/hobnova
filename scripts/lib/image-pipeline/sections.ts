import type { ArticleSection, InlineImageStyle, SelectedSection } from './types';

const H2_PATTERN = /^##\s+(.+)$/gm;

/**
 * Markdown本文をH2見出し単位で分割する。最初のH2より前のリード文は対象外（見出しに
 * 紐付かないため画像挿入の基準にできない）。
 */
export function parseSections(body: string): ArticleSection[] {
  const matches = [...body.matchAll(H2_PATTERN)];
  const sections: ArticleSection[] = [];

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const heading = match[1].trim();
    const headingStartIndex = match.index ?? 0;
    const headingEndIndex = headingStartIndex + match[0].length;
    const sectionEnd = i + 1 < matches.length ? (matches[i + 1].index ?? body.length) : body.length;
    const sectionBody = body.slice(headingEndIndex, sectionEnd);

    sections.push({ heading, body: sectionBody, headingStartIndex, headingEndIndex });
  }

  return sections;
}

/** 本文の目安文字数から、挿入する本文画像の目標枚数（上限）を決める。 */
export function targetInlineImageCount(bodyLength: number): number {
  if (bodyLength < 1500) return 1;
  if (bodyLength < 3000) return 2;
  if (bodyLength < 5000) return 3;
  return 4; // ハードキャップ（コスト暴走防止）。文字数に関わらずこれ以上は生成しない。
}

// 画像を入れても意味が薄い（除外する）見出しパターン。
const EXCLUDE_HEADING_PATTERNS = [
  /まとめ/, /結論/, /総括/, /おわりに/,
  /faq/i, /よくある質問/, /q\s*&\s*a/i,
  /注意/, /免責/,
  /参考/, /出典/, /参照/, /リンク集/,
];

// 画像を優先したい見出し/本文キーワード（スコア加点）。
const PRIORITY_KEYWORDS: Array<{ pattern: RegExp; score: number; style: InlineImageStyle; reason: string }> = [
  { pattern: /比較|vs\.?|対決/i, score: 3, style: 'product-editorial', reason: '製品・選択肢の比較' },
  { pattern: /使用シーン|使い方|活用シーン|シーン/, score: 3, style: 'lifestyle-photography-like', reason: '使用シーンの説明' },
  { pattern: /仕組み|構造|原理|メカニズム/, score: 3, style: 'realistic-spatial-composition', reason: '構造・仕組みの説明' },
  { pattern: /ライフスタイル|暮らし|生活/, score: 2, style: 'lifestyle-photography-like', reason: 'ライフスタイル比較' },
  { pattern: /選び方|選ぶ|タイプ別|種類/, score: 2, style: 'clean-object-composition', reason: '複数の選択肢の説明' },
  { pattern: /購入|買い替え|おすすめ/, score: 2, style: 'product-editorial', reason: '購入判断のイメージ補助' },
  { pattern: /before|after|ビフォー|アフター/i, score: 3, style: 'lifestyle-photography-like', reason: 'Before/After的な内容' },
  { pattern: /技術|規格|テクノロジー/, score: 1, style: 'realistic-spatial-composition', reason: '技術概念の説明' },
];

const DEFAULT_STYLE: InlineImageStyle = 'clean-object-composition';

function isExcluded(section: ArticleSection): boolean {
  return EXCLUDE_HEADING_PATTERNS.some((pattern) => pattern.test(section.heading));
}

function scoreSection(section: ArticleSection): { score: number; style: InlineImageStyle; reason: string } {
  const haystack = `${section.heading}\n${section.body}`;
  let best = { score: 0, style: DEFAULT_STYLE, reason: '一般的な解説セクション' };

  for (const rule of PRIORITY_KEYWORDS) {
    if (rule.pattern.test(haystack)) {
      // 複数キーワードにマッチした場合はスコア最大のものを採用する。
      if (rule.score > best.score) {
        best = { score: rule.score, style: rule.style, reason: rule.reason };
      } else if (rule.score === best.score) {
        best.score += 1; // 複数ヒットは画像の効果が高い可能性が高いため少し優先度を上げる
      }
    }
  }

  // 本文が極端に短い節（箇条書きだけの短い節等）は画像効果が薄いため減点する。
  const plainTextLength = section.body.replace(/[#*>`|-]/g, '').trim().length;
  if (plainTextLength < 80) best.score = Math.max(0, best.score - 2);

  return best;
}

/**
 * H2セクションの中から、画像を入れる意味が薄い節（まとめ/FAQ/注意事項/参考リンク等）を
 * 除外した上で、画像が理解を助ける可能性が高い節を maxCount 件まで選ぶ。
 * 選定結果は元の文書順（上から下）で返す。
 */
export function selectSectionsForImages(sections: ArticleSection[], maxCount: number): SelectedSection[] {
  if (maxCount <= 0) return [];

  const candidates = sections
    .map((section, index) => ({ section, index, ...scoreSection(section) }))
    .filter((c) => !isExcluded(c.section));

  const ranked = [...candidates].sort((a, b) => b.score - a.score || a.index - b.index).slice(0, maxCount);
  const chosenIndexes = new Set(ranked.map((c) => c.index));

  return candidates
    .filter((c) => chosenIndexes.has(c.index))
    .map((c) => ({ section: c.section, style: c.style, reason: c.reason }));
}
