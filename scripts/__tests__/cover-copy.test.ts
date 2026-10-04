import { describe, expect, it } from 'vitest';
import { buildCoverCopy } from '../lib/image-pipeline/cover-copy';

describe('buildCoverCopy', () => {
  it('タイトルの丸写しではなく短い要約を返す', () => {
    const title = 'Wi-Fi 7は必要？Wi-Fi 6Eとの違いを320MHz・MLO・6GHzで整理';
    const description =
      'Wi-Fi 7とWi-Fi 6Eの違いを、320MHz幅、4K-QAM、MLO、6GHz対応から整理。買い替えで効果が出やすい環境と、急いで変えなくていいケースを解説します。';
    const copy = buildCoverCopy(title, description);

    expect(copy.line1 + copy.line2).not.toBe(title);
    expect(copy.line1).toContain('Wi-Fi 7は必要？');
  });

  it('合計文字数は10〜24字の範囲に収まる', () => {
    const cases: Array<[string, string]> = [
      [
        'Wi-Fi 7は必要？Wi-Fi 6Eとの違いを320MHz・MLO・6GHzで整理',
        'Wi-Fi 7とWi-Fi 6Eの違いを整理し、買い替え判断を解説します。',
      ],
      [
        '10万円以下プロジェクターをANSIルーメン単価で比較｜明るさのコスパを数値化',
        '10万円以下で購入できる主要プロジェクターをANSIルーメンと価格から比較します。',
      ],
      ['非常に短いタイトル', '短い説明文です。'],
      [
        'とても長くて複雑で専門用語がたくさん詰め込まれたタイトルの例をここに示します',
        '長いタイトルの場合でも適切に短縮される必要があります。これはテスト用の説明文です。',
      ],
    ];

    for (const [title, description] of cases) {
      const copy = buildCoverCopy(title, description);
      const total = copy.line1.length + copy.line2.length;
      expect(total).toBeGreaterThanOrEqual(10);
      expect(total).toBeLessThanOrEqual(24);
    }
  });

  it('各行は空文字列にならない、または少なくともline1は非空', () => {
    const copy = buildCoverCopy('短いタイトル', '説明文');
    expect(copy.line1.length).toBeGreaterThan(0);
  });

  it('？を含むタイトルではline1がフック部分になる', () => {
    const copy = buildCoverCopy('これは必要？それとも不要かを徹底解説する長いタイトル', '説明文です。');
    expect(copy.line1).toMatch(/？$/);
  });

  it('descriptionへのフォールバックでも極端に長い行にならない', () => {
    const copy = buildCoverCopy(
      '区切り文字が全くないタイトルの例',
      'これは非常に長い説明文であり、特に区切りとなる句点が最初のほうに存在しないケースのテストです。'
    );
    expect(copy.line1.length).toBeLessThanOrEqual(16);
    expect(copy.line2.length).toBeLessThanOrEqual(16);
  });
});
