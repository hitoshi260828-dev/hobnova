import type { InlineImageStyle, SelectedSection } from './types';
import type { CoverCopy } from './cover-copy';

// HOBNOVA共通のビジュアル指示。カバー画像（OpenAI）に使用する。
// カバーは「記事テーマを表現するビジュアル + 日本語コピー」を1枚にまとめる方式のため、
// 本文画像（Cloudflare、文字なし方針）とは異なり、意図的に文字を描かせる。
export const HOBNOVA_VISUAL_GUIDELINE = `Editorial eye-catch image for HOBNOVA, a Japanese technology and lifestyle web media.
Clean, modern, sophisticated editorial visual, in the style of a Japanese web media's eye-catch thumbnail.
Minimal composition with generous negative space.
Neutral and monochrome-oriented palette with a restrained, content-appropriate accent color.
Avoid an overly "generic AI-generated" look.
No excessive glow.
No logos.
No watermark.
No random UI elements.
Professional technology/lifestyle magazine aesthetic.`;

export interface CoverPromptInput {
  title: string;
  description: string;
  category: string;
  /** 記事の主要結論（descriptionまたは最初のセクション要約から渡す） */
  mainTakeaway: string;
  /** 本文の冒頭抜粋（テーマ把握用。長すぎる場合は呼び出し側で切り詰める） */
  bodyExcerpt: string;
  /** 画像内に表示する日本語コピー（2行以内、buildCoverCopyで生成） */
  copy: CoverCopy;
}

/**
 * アイキャッチ画像のプロンプト。タイトルだけでなくdescription/category/本文/結論を
 * 反映する。記事内容を要約した日本語コピーを画像内へ明確に表示することを指示する
 * （本文画像とは逆に、文字を描かせる方針）。日本語の文字崩れを避けることを重視する。
 */
export function buildCoverPrompt(input: CoverPromptInput): string {
  const { line1, line2 } = input.copy;
  const copyDisplay = line2 ? `${line1}\n${line2}` : line1;

  return `${HOBNOVA_VISUAL_GUIDELINE}

Article title: ${input.title}
Category: ${input.category}
Summary: ${input.description}
Key takeaway: ${input.mainTakeaway}
Article context: ${input.bodyExcerpt}

This is the eye-catch/cover image for the article above. Depict the article's core subject
visually as the background/supporting visual, and prominently display the following Japanese
copy text as the main typographic element of the image, exactly as written (do not translate,
paraphrase, or alter the text in any way):

"""
${copyDisplay}
"""

Typography and layout requirements (highest priority):
- Render the Japanese text completely accurately, with no corrupted, garbled, or malformed
  characters. Double-check that every character is a real, correctly-formed Japanese character.
- Keep the copy to ${line2 ? 'two lines, exactly as line-broken above' : 'a single line'}.
- Text legibility is the top priority: use strong contrast between the text and its background,
  ample surrounding whitespace/negative space, and a clean modern sans-serif-style Japanese
  typography suitable for a web media thumbnail.
- The text must not overlap with the photographic/product visual — keep them in clearly separate
  areas of the composition.
- Do not add any other text, labels, logos, or captions beyond the copy text specified above.`;
}

// 本文画像（Cloudflare）のスタイル指示。
// 重要: "infographic" "diagram" "label" "UI" "signage" を連想させる語は、モデルが
// プロンプトへ文字・ラベルを描き込む強いバイアスになることを実地検証で確認したため、
// 原則として使わない。代わりに実写・編集写真的な構図の語彙で表現する。
const STYLE_HINT: Record<InlineImageStyle, string> = {
  'product-editorial':
    'editorial product photography-like illustration, placing the compared items side by side in a realistic setting so their differences read visually',
  'lifestyle-photography-like':
    'lifestyle photography-like illustration showing the subject being used in an authentic, real-world scene',
  'realistic-spatial-composition':
    'realistic spatial composition that conveys the mechanism or relationship through the physical arrangement of real objects in a believable environment, photographed naturally',
  'clean-object-composition':
    'clean object composition, a small set of real physical items arranged thoughtfully on a simple surface, editorial product-photography styling',
};

export interface InlineSectionSummaryInput {
  articleTitle: string;
  section: SelectedSection;
  /** セクション本文から切り出した要約（呼び出し側で整形済みのプレーンテキスト） */
  sectionSummary: string;
}

/**
 * 本文画像のプロンプト。対象H2/H3とその周辺本文を使い、記事タイトルだけに頼らない。
 * 主題・対象物・使用シーンを明示し、実写的な構図を優先する。禁止事項は冗長なくらい
 * 明示的に列挙する（モデルがinfographic的な文字描画へ流れるのを防ぐため）。
 */
export function buildInlineImagePrompt(input: InlineSectionSummaryInput): string {
  return `Editorial illustration for a Japanese technology and lifestyle article.

Article topic (overall subject):
${input.articleTitle}

Section heading:
${input.section.section.heading}

Section context (use this to identify the specific subject, object, and usage scene to depict):
${input.sectionSummary}

Depict the specific subject/object described above, placed in a realistic usage scene or
product arrangement that matches this section's content. Prioritize:
- editorial photography-like illustration
- product or lifestyle scene
- clean object composition
- realistic spatial composition
${STYLE_HINT[input.section.style]}.

Style: clean editorial illustration, realistic proportions, minimal modern composition,
professional Japanese web magazine aesthetic, neutral colors, avoid generic AI art, avoid
excessive futuristic glow.

Strictly avoid all of the following in the image:
no text, no letters, no numbers, no labels, no logos, no signs, no packaging text,
no UI elements, no watermark.`;
}

/** セクション本文からプロンプト用の短い要約プレーンテキストを作る（先頭数文、見出し等は除去）。 */
export function summarizeSectionForPrompt(sectionBody: string, maxChars = 300): string {
  const plain = sectionBody
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*]\([^)]*\)/g, (m) => m.replace(/\[|]\([^)]*\)/g, ''))
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_>`|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return plain.length > maxChars ? `${plain.slice(0, maxChars)}…` : plain;
}

/**
 * alt textを見出し・選定理由から組み立てる（LLMによる要約は行わない、ルールベースの生成）。
 * 「記事画像」のような空疎な説明は避け、具体的な対象が分かる文にする。
 * 見出しをそのまま主語として直結すると文法的に不自然になるケースがあるため、
 * 「見出し」を鉤括弧で囲んで独立させ、末尾の説明句と自然につながる形にする。
 */
export function generateAltText(section: SelectedSection): string {
  const heading = section.section.heading.replace(/[「」『』]/g, '').trim();
  const quoted = `「${heading}」`;

  switch (section.style) {
    case 'product-editorial':
      return `${quoted}について選択肢を比較しているイメージ`;
    case 'lifestyle-photography-like':
      return `${quoted}を実際に利用している場面のイメージ`;
    case 'realistic-spatial-composition':
      return `${quoted}の関係性を示すイメージ`;
    case 'clean-object-composition':
    default:
      return `${quoted}の内容を整理したイメージ`;
  }
}
