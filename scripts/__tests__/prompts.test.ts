import { describe, expect, it } from 'vitest';
import { buildCoverPrompt, buildInlineImagePrompt, generateAltText, summarizeSectionForPrompt } from '../lib/image-pipeline/prompts';
import type { SelectedSection } from '../lib/image-pipeline/types';

describe('buildCoverPrompt', () => {
  it('title/description/category/結論/本文を全て含む', () => {
    const prompt = buildCoverPrompt({
      title: 'テスト記事タイトル',
      description: 'テストの説明文です',
      category: 'gadget',
      mainTakeaway: '主要な結論テキスト',
      bodyExcerpt: '本文の抜粋テキスト',
    });
    expect(prompt).toContain('テスト記事タイトル');
    expect(prompt).toContain('テストの説明文です');
    expect(prompt).toContain('gadget');
    expect(prompt).toContain('主要な結論テキスト');
    expect(prompt).toContain('本文の抜粋テキスト');
  });

  it('文字を描かせない指示を含む', () => {
    const prompt = buildCoverPrompt({
      title: 't',
      description: 'd',
      category: 'c',
      mainTakeaway: 'm',
      bodyExcerpt: 'b',
    });
    expect(prompt).toMatch(/no text|No unnecessary text/i);
  });
});

function makeSelected(heading: string, style: SelectedSection['style']): SelectedSection {
  return {
    section: { heading, body: '本文テキスト', headingStartIndex: 0, headingEndIndex: 0 },
    style,
    reason: 'test',
  };
}

describe('buildInlineImagePrompt', () => {
  it('記事タイトルだけでなく対象セクションの見出し・要約を含む', () => {
    const prompt = buildInlineImagePrompt({
      articleTitle: '記事タイトル',
      section: makeSelected('対象の見出し', 'product-editorial'),
      sectionSummary: 'セクションの要約文',
    });
    expect(prompt).toContain('記事タイトル');
    expect(prompt).toContain('対象の見出し');
    expect(prompt).toContain('セクションの要約文');
  });

  it('画像内に文字を書かせない指示を含む', () => {
    const prompt = buildInlineImagePrompt({
      articleTitle: 't',
      section: makeSelected('h', 'conceptual-diagram'),
      sectionSummary: 's',
    });
    expect(prompt).toMatch(/do not render any text/i);
  });
});

describe('summarizeSectionForPrompt', () => {
  it('Markdown記法・画像記法を除去する', () => {
    const summary = summarizeSectionForPrompt('**強調** と ![alt](./img.png) と [リンク](https://example.com) です。');
    expect(summary).not.toContain('![');
    expect(summary).not.toContain('**');
  });

  it('maxCharsを超える場合は省略記号で切り詰める', () => {
    const long = 'あ'.repeat(500);
    const summary = summarizeSectionForPrompt(long, 100);
    expect(summary.length).toBeLessThanOrEqual(101);
    expect(summary.endsWith('…')).toBe(true);
  });
});

describe('generateAltText', () => {
  it('「記事画像」のような空疎な文字列を返さない', () => {
    const alt = generateAltText(makeSelected('ドラム式洗濯機の選び方', 'product-editorial'));
    expect(alt).not.toBe('記事画像');
    expect(alt.length).toBeGreaterThan(5);
    expect(alt).toContain('ドラム式洗濯機の選び方');
  });

  it('スタイルごとに異なる文言を生成する', () => {
    const a = generateAltText(makeSelected('見出し', 'product-editorial'));
    const b = generateAltText(makeSelected('見出し', 'lifestyle-photography-like'));
    const c = generateAltText(makeSelected('見出し', 'conceptual-diagram'));
    const d = generateAltText(makeSelected('見出し', 'infographic-like'));
    const unique = new Set([a, b, c, d]);
    expect(unique.size).toBe(4);
  });
});
