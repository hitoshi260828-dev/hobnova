import { describe, expect, it } from 'vitest';
import { insertInlineImages, isAlreadyInserted } from '../lib/image-pipeline/markdown-insert';

describe('insertInlineImages', () => {
  it('指定位置にMarkdown画像記法を挿入する', () => {
    const body = '## 見出し\n本文です。';
    const headingEndIndex = body.indexOf('\n本文です。');
    const result = insertInlineImages(body, [
      { headingEndIndex, alt: 'テストalt', referencePath: '/images/articles/x/inline-01.jpg' },
    ]);
    expect(result).toContain('![テストalt](/images/articles/x/inline-01.jpg)');
    expect(result.indexOf('![テストalt]')).toBeLessThan(result.indexOf('本文です。'));
  });

  it('複数挿入してもインデックスがずれず全て正しい位置に入る', () => {
    const body = '## 見出し1\n本文1\n## 見出し2\n本文2';
    const idx1 = body.indexOf('\n本文1');
    const idx2 = body.indexOf('\n本文2');

    const result = insertInlineImages(body, [
      { headingEndIndex: idx1, alt: 'alt1', referencePath: '/img1.jpg' },
      { headingEndIndex: idx2, alt: 'alt2', referencePath: '/img2.jpg' },
    ]);

    expect(result).toContain('![alt1](/img1.jpg)');
    expect(result).toContain('![alt2](/img2.jpg)');
    expect(result.indexOf('![alt1]')).toBeLessThan(result.indexOf('本文1'));
    expect(result.indexOf('![alt2]')).toBeLessThan(result.indexOf('本文2'));
    expect(result.indexOf('本文1')).toBeLessThan(result.indexOf('![alt2]'));
  });

  it('挿入なしなら本文を変更しない', () => {
    const body = '変更されない本文';
    expect(insertInlineImages(body, [])).toBe(body);
  });
});

describe('isAlreadyInserted', () => {
  it('同じ画像パスが既に本文にあればtrue', () => {
    const body = '本文 ![alt](/images/articles/x/inline-01.jpg) です。';
    expect(isAlreadyInserted(body, '/images/articles/x/inline-01.jpg')).toBe(true);
  });

  it('含まれていなければfalse', () => {
    expect(isAlreadyInserted('本文です', '/images/articles/x/inline-01.jpg')).toBe(false);
  });
});
