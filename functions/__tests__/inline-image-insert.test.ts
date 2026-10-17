import { describe, expect, it } from 'vitest';
import { findHeadings, insertInlineImage, isAlreadyInserted, resolveInsertPosition } from '../_lib/inline-image-insert';

const SAMPLE = `---
title: "テスト記事"
---

導入文です。

## 製品の比較ポイント

比較についての本文です。

## 使用シーンの紹介

使用シーンについての本文です。

## まとめ

- まとめ1
`;

describe('findHeadings', () => {
  it('H2見出しを順番に列挙する', () => {
    const headings = findHeadings(SAMPLE);
    expect(headings.map((h) => h.heading)).toEqual(['製品の比較ポイント', '使用シーンの紹介', 'まとめ']);
  });

  it('見出しが無ければ空配列を返す', () => {
    expect(findHeadings('本文のみ、見出しなし')).toEqual([]);
  });
});

describe('resolveInsertPosition', () => {
  it('after_headingで完全一致する見出しを解決する', () => {
    const result = resolveInsertPosition(SAMPLE, { afterHeading: '使用シーンの紹介' });
    expect('error' in result).toBe(false);
    if (!('error' in result)) expect(result.heading).toBe('使用シーンの紹介');
  });

  it('存在しないafter_headingはエラーを返す', () => {
    const result = resolveInsertPosition(SAMPLE, { afterHeading: '存在しない見出し' });
    expect('error' in result).toBe(true);
  });

  it('positionで1始まりの番号指定を解決する', () => {
    const result = resolveInsertPosition(SAMPLE, { position: 2 });
    expect('error' in result).toBe(false);
    if (!('error' in result)) expect(result.heading).toBe('使用シーンの紹介');
  });

  it('範囲外のpositionはエラーを返す', () => {
    expect('error' in resolveInsertPosition(SAMPLE, { position: 0 })).toBe(true);
    expect('error' in resolveInsertPosition(SAMPLE, { position: 99 })).toBe(true);
  });

  it('after_headingもpositionも無ければエラーを返す', () => {
    expect('error' in resolveInsertPosition(SAMPLE, {})).toBe(true);
  });
});

describe('insertInlineImage / isAlreadyInserted', () => {
  it('指定位置へMarkdown画像記法を挿入する', () => {
    const headings = findHeadings(SAMPLE);
    const target = headings[0];
    const updated = insertInlineImage(SAMPLE, target.headingEndIndex, 'テスト画像', '/images/articles/test/inline-01.jpg');
    expect(updated).toContain('![テスト画像](/images/articles/test/inline-01.jpg)');
    const insertIndex = updated.indexOf('inline-01.jpg');
    const sectionIndex = updated.indexOf('比較についての本文');
    expect(insertIndex).toBeLessThan(sectionIndex);
  });

  it('同じ参照パスが既にあればtrueを返す（二重挿入防止）', () => {
    const withImage = SAMPLE.replace('比較についての本文', '![x](/images/articles/test/inline-01.jpg)\n\n比較についての本文');
    expect(isAlreadyInserted(withImage, '/images/articles/test/inline-01.jpg')).toBe(true);
    expect(isAlreadyInserted(withImage, '/images/articles/test/inline-02.jpg')).toBe(false);
  });
});
