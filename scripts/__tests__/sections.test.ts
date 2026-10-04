import { describe, expect, it } from 'vitest';
import { parseSections, selectSectionsForImages, targetInlineImageCount } from '../lib/image-pipeline/sections';

const SAMPLE_BODY = `
導入文です。

## 製品比較：モデルA vs モデルB

比較の本文がここに入ります。それぞれの特徴を解説する長めの段落です。使用シーンに応じて選び方が変わります。

## 使い方・使用シーン

実際に使うシーンを解説します。生活の中でどう役立つかを詳しく説明する段落です。

## まとめ

- 結論1
- 結論2

## よくある質問

Q. 質問1
A. 回答1
`;

describe('parseSections', () => {
  it('H2見出しごとに分割する', () => {
    const sections = parseSections(SAMPLE_BODY);
    expect(sections.map((s) => s.heading)).toEqual([
      '製品比較：モデルA vs モデルB',
      '使い方・使用シーン',
      'まとめ',
      'よくある質問',
    ]);
  });

  it('各セクションの本文には次の見出しを含まない', () => {
    const sections = parseSections(SAMPLE_BODY);
    expect(sections[0].body).toContain('比較の本文');
    expect(sections[0].body).not.toContain('使い方・使用シーン');
  });

  it('H2がない本文では空配列を返す', () => {
    expect(parseSections('見出しのない本文です。')).toEqual([]);
  });
});

describe('targetInlineImageCount', () => {
  it('文字数に応じた目標枚数を返す（上限4枚）', () => {
    expect(targetInlineImageCount(500)).toBe(1);
    expect(targetInlineImageCount(1499)).toBe(1);
    expect(targetInlineImageCount(1500)).toBe(2);
    expect(targetInlineImageCount(2999)).toBe(2);
    expect(targetInlineImageCount(3000)).toBe(3);
    expect(targetInlineImageCount(4999)).toBe(3);
    expect(targetInlineImageCount(5000)).toBe(4);
    expect(targetInlineImageCount(50000)).toBe(4); // ハードキャップ
  });
});

describe('selectSectionsForImages', () => {
  it('まとめ・FAQは除外する', () => {
    const sections = parseSections(SAMPLE_BODY);
    const selected = selectSectionsForImages(sections, 4);
    const headings = selected.map((s) => s.section.heading);
    expect(headings).not.toContain('まとめ');
    expect(headings).not.toContain('よくある質問');
  });

  it('比較・使用シーンのセクションを優先して選ぶ', () => {
    const sections = parseSections(SAMPLE_BODY);
    const selected = selectSectionsForImages(sections, 1);
    expect(selected).toHaveLength(1);
    expect(['製品比較：モデルA vs モデルB', '使い方・使用シーン']).toContain(selected[0].section.heading);
  });

  it('maxCountを超えて選ばない', () => {
    const sections = parseSections(SAMPLE_BODY);
    const selected = selectSectionsForImages(sections, 1);
    expect(selected.length).toBeLessThanOrEqual(1);
  });

  it('選定結果は元の文書順を保つ', () => {
    const sections = parseSections(SAMPLE_BODY);
    const selected = selectSectionsForImages(sections, 2);
    const indexes = selected.map((s) => sections.findIndex((orig) => orig.heading === s.section.heading));
    const sortedIndexes = [...indexes].sort((a, b) => a - b);
    expect(indexes).toEqual(sortedIndexes);
  });

  it('maxCountが0なら何も選ばない', () => {
    const sections = parseSections(SAMPLE_BODY);
    expect(selectSectionsForImages(sections, 0)).toEqual([]);
  });
});
