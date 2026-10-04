import type { InlineImageStyle, SelectedSection } from './types';

// HOBNOVA共通のビジュアル指示。全てのカバー画像・本文画像で共通して付与する。
export const HOBNOVA_VISUAL_GUIDELINE = `Editorial illustration for HOBNOVA, a Japanese technology and lifestyle media site.
Clean, modern, sophisticated editorial visual.
Minimal composition.
Neutral and monochrome-oriented palette with restrained accent colors.
Not a generic AI-generated fantasy image.
No excessive glow.
No unnecessary text.
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
}

/**
 * アイキャッチ画像のプロンプト。タイトルだけでなくdescription/category/本文/結論を
 * 反映する。文字を描かせないことを明示する。
 */
export function buildCoverPrompt(input: CoverPromptInput): string {
  return `${HOBNOVA_VISUAL_GUIDELINE}

Article title: ${input.title}
Category: ${input.category}
Summary: ${input.description}
Key takeaway: ${input.mainTakeaway}
Article context: ${input.bodyExcerpt}

This is the eye-catch/cover image for the article above. Depict the article's core subject and
key takeaway visually, without relying on any text in the image. Do not render any words, titles,
or captions — the title is displayed separately on the website.`;
}

const STYLE_HINT: Record<InlineImageStyle, string> = {
  'infographic-like':
    'infographic-like composition that communicates structure through layout and iconography alone (no embedded text or labels)',
  'product-editorial': 'product editorial photography-like illustration, comparing the items clearly',
  'lifestyle-photography-like': 'lifestyle photography-like illustration showing real-world use',
  'conceptual-diagram': 'conceptual diagram illustrating the mechanism or structure, without embedded text or labels',
};

export interface InlineSectionSummaryInput {
  articleTitle: string;
  section: SelectedSection;
  /** セクション本文から切り出した要約（呼び出し側で整形済みのプレーンテキスト） */
  sectionSummary: string;
}

/** 本文画像のプロンプト。対象H2/H3とその周辺本文を使い、記事タイトルだけに頼らない。 */
export function buildInlineImagePrompt(input: InlineSectionSummaryInput): string {
  return `Editorial illustration for a Japanese technology and lifestyle article.

Article topic:
${input.articleTitle}

Section:
${input.section.section.heading}

Context:
${input.sectionSummary}

Create a clear visual that helps the reader understand this section.

Style:
clean editorial illustration,
realistic proportions,
minimal modern composition,
professional Japanese web magazine,
neutral colors,
no text,
no logo,
no watermark,
avoid generic AI art,
avoid excessive futuristic glow,
${STYLE_HINT[input.section.style]}.

Important: do not render any text, labels, or captions inside the image — if labels would be
needed to explain the diagram, the website will add them separately with SVG/HTML/CSS.`;
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
    case 'conceptual-diagram':
      return `${quoted}の仕組みを示すイメージ`;
    case 'infographic-like':
    default:
      return `${quoted}の内容を整理したイメージ`;
  }
}
