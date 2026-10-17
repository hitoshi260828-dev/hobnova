import { describe, expect, it } from 'vitest';
import { buildNewsMarkdown, newsFilePath, newsSlug } from '../lib/news/markdown.mjs';

const BASE_INPUT = {
  date: '2026-10-18',
  edition: 'morning' as const,
  publishedAtIso: '2026-10-18T08:00:00+09:00',
  title: 'テストタイトル',
  description: 'テスト説明文',
  topics: ['ai', 'tech'],
  coverRelativePath: './2026-10-18-morning-hero.png',
  items: [
    {
      heading: '見出し1',
      body: '本文1',
      sourceName: 'Example News',
      sourceUrl: 'https://example.com/a',
      sourcePublishedDate: '2026-10-18',
    },
    {
      heading: '見出し2',
      body: '本文2',
      sourceName: 'Example News B',
      sourceUrl: 'https://example.com/b',
    },
  ],
};

describe('newsSlug / newsFilePath', () => {
  it('日付+editionからslugを組み立てる', () => {
    expect(newsSlug('2026-10-18', 'morning')).toBe('2026-10-18-morning');
    expect(newsSlug('2026-10-18', 'evening')).toBe('2026-10-18-evening');
  });

  it('newsFilePathはsrc/content/news/配下のパスを返す', () => {
    expect(newsFilePath('2026-10-18', 'morning')).toBe('src/content/news/2026-10-18-morning.md');
  });
});

describe('buildNewsMarkdown', () => {
  it('frontmatterに必要なフィールドを全て含む', () => {
    const md = buildNewsMarkdown(BASE_INPUT);
    expect(md).toContain('edition: morning');
    expect(md).toContain('cover: "./2026-10-18-morning-hero.png"');
    expect(md).toContain('topics:');
    expect(md).toContain('  - ai');
    expect(md).toContain('  - tech');
    expect(md).toContain('sourceCount: 2');
    expect(md).toContain('draft: false');
  });

  it('各itemのsourceがfrontmatter sourcesへ反映される', () => {
    const md = buildNewsMarkdown(BASE_INPUT);
    expect(md).toContain('name: "Example News"');
    expect(md).toContain('url: "https://example.com/a"');
    expect(md).toContain('publishedDate: "2026-10-18"');
    expect(md).toContain('accessedDate: 2026-10-18');
  });

  it('sourcePublishedDate省略時はpublishedDate行を出力しない', () => {
    const md = buildNewsMarkdown(BASE_INPUT);
    const bSourceBlock = md.split('name: "Example News B"')[1].split('\n  - name:')[0];
    expect(bSourceBlock).not.toContain('publishedDate:');
    expect(bSourceBlock).toContain('accessedDate: 2026-10-18');
  });

  it('本文に各itemの見出し・本文・出典リンクを含む', () => {
    const md = buildNewsMarkdown(BASE_INPUT);
    expect(md).toContain('## 見出し1');
    expect(md).toContain('本文1');
    expect(md).toContain('[Example News](https://example.com/a)');
  });

  it('topicsが未指定/不正な場合はエラーを投げる', () => {
    expect(() => buildNewsMarkdown({ ...BASE_INPUT, topics: ['not-a-real-topic'] })).toThrow(/topics/);
    expect(() => buildNewsMarkdown({ ...BASE_INPUT, topics: [] })).toThrow(/topics/);
  });

  it('itemsが空の場合はエラーを投げる', () => {
    expect(() => buildNewsMarkdown({ ...BASE_INPUT, items: [] })).toThrow(/items/);
  });

  it('coverRelativePathが無い場合はエラーを投げる（画像なし記事の防止）', () => {
    const { coverRelativePath, ...withoutCover } = BASE_INPUT;
    expect(() => buildNewsMarkdown(withoutCover as never)).toThrow(/coverRelativePath/);
  });

  it('タイトル・説明文に二重引用符や特殊文字が含まれてもYAMLとして安全にエスケープされる', () => {
    const md = buildNewsMarkdown({ ...BASE_INPUT, title: 'テスト"タイトル"：コロン付き' });
    expect(md).toContain('title: "テスト\\"タイトル\\"：コロン付き"');
  });
});
