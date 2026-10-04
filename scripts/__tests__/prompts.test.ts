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
      copy: { line1: 'テストコピー1', line2: 'テストコピー2' },
    });
    expect(prompt).toContain('テスト記事タイトル');
    expect(prompt).toContain('テストの説明文です');
    expect(prompt).toContain('gadget');
    expect(prompt).toContain('主要な結論テキスト');
    expect(prompt).toContain('本文の抜粋テキスト');
  });

  it('日本語コピーを画像内へ明確に表示する指示を含む（2行指定）', () => {
    const prompt = buildCoverPrompt({
      title: 't',
      description: 'd',
      category: 'c',
      mainTakeaway: 'm',
      bodyExcerpt: 'b',
      copy: { line1: 'コピー1行目', line2: 'コピー2行目' },
    });
    expect(prompt).toContain('コピー1行目');
    expect(prompt).toContain('コピー2行目');
    expect(prompt).toMatch(/two lines/i);
  });

  it('line2が空なら単一行として指示する', () => {
    const prompt = buildCoverPrompt({
      title: 't',
      description: 'd',
      category: 'c',
      mainTakeaway: 'm',
      bodyExcerpt: 'b',
      copy: { line1: 'コピー1行だけ', line2: '' },
    });
    expect(prompt).toContain('コピー1行だけ');
    expect(prompt).toMatch(/single line/i);
  });

  it('日本語の文字崩れを避ける指示・可読性優先・文字と写真を重ねない指示を含む', () => {
    const prompt = buildCoverPrompt({
      title: 't',
      description: 'd',
      category: 'c',
      mainTakeaway: 'm',
      bodyExcerpt: 'b',
      copy: { line1: 'x', line2: 'y' },
    });
    expect(prompt).toMatch(/garbled|malformed/i);
    expect(prompt).toMatch(/legibility/i);
    expect(prompt).toMatch(/must not overlap/i);
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

  it('画像内に文字・数字・ロゴ等を書かせない禁止事項を明示的に列挙する', () => {
    const prompt = buildInlineImagePrompt({
      articleTitle: 't',
      section: makeSelected('h', 'realistic-spatial-composition'),
      sectionSummary: 's',
    });
    expect(prompt).toMatch(/no text/i);
    expect(prompt).toMatch(/no letters/i);
    expect(prompt).toMatch(/no numbers/i);
    expect(prompt).toMatch(/no labels/i);
    expect(prompt).toMatch(/no logos/i);
    expect(prompt).toMatch(/no signs/i);
    expect(prompt).toMatch(/no packaging text/i);
    expect(prompt).toMatch(/no UI elements/i);
    expect(prompt).toMatch(/no watermark/i);
  });

  it('infographic/diagram/label/UI/signageを連想させる語を使わない', () => {
    for (const style of ['product-editorial', 'lifestyle-photography-like', 'realistic-spatial-composition', 'clean-object-composition'] as const) {
      const prompt = buildInlineImagePrompt({
        articleTitle: 't',
        section: makeSelected('h', style),
        sectionSummary: 's',
      });
      // 禁止事項の列挙（"no labels"等）は許可するが、スタイル指示として
      // infographic/diagram/signageという単語そのものは使わない。
      expect(prompt).not.toMatch(/infographic/i);
      expect(prompt).not.toMatch(/\bdiagram\b/i);
      expect(prompt).not.toMatch(/signage/i);
    }
  });

  it('主題・対象物・使用シーンを明示する指示を含む', () => {
    const prompt = buildInlineImagePrompt({
      articleTitle: 't',
      section: makeSelected('h', 'product-editorial'),
      sectionSummary: 's',
    });
    expect(prompt).toMatch(/subject/i);
    expect(prompt).toMatch(/usage scene|realistic usage scene/i);
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
    const c = generateAltText(makeSelected('見出し', 'realistic-spatial-composition'));
    const d = generateAltText(makeSelected('見出し', 'clean-object-composition'));
    const unique = new Set([a, b, c, d]);
    expect(unique.size).toBe(4);
  });
});
