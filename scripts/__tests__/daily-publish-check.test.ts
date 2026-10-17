import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildProductionUrl, findPublishedToday } from '../daily-publish-check.mjs';

describe('findPublishedToday', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hobnova-daily-check-'));
    fs.mkdirSync(path.join(tmpDir, 'src/content/articles'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'src/content/data-lab'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'src/content/tools'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('本日付のpublishDateを持つ記事が無ければnullを返す', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'src/content/articles/old-article.md'),
      '---\ntitle: "古い記事"\npublishDate: 2026-10-01\ncategory: "gadget"\n---\n\n本文\n'
    );
    expect(findPublishedToday('2026-10-17', tmpDir)).toBeNull();
  });

  it('本日付のpublishDateを持つ記事（articles）があれば検出する', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'src/content/articles/new-article.md'),
      '---\ntitle: "新しい記事"\npublishDate: 2026-10-17\ncategory: "gadget"\n---\n\n本文\n'
    );
    const result = findPublishedToday('2026-10-17', tmpDir);
    expect(result).not.toBeNull();
    expect(result?.collection).toBe('articles');
  });

  it('ISO日時形式（2026-10-17T00:00:00.000Z）のpublishDateも日付部分だけで一致判定する', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'src/content/articles/iso-date.md'),
      '---\ntitle: "ISO日付記事"\npublishDate: 2026-10-17T00:00:00.000Z\ncategory: "camp"\n---\n\n本文\n'
    );
    expect(findPublishedToday('2026-10-17', tmpDir)).not.toBeNull();
  });

  it('data-lab/toolsコレクションも検出する', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'src/content/data-lab/new-data.md'),
      '---\ntitle: "新しいデータ"\npublishDate: 2026-10-17\n---\n\n本文\n'
    );
    const result = findPublishedToday('2026-10-17', tmpDir);
    expect(result?.collection).toBe('data-lab');
  });
});

describe('buildProductionUrl', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hobnova-daily-check-url-'));
    fs.mkdirSync(path.join(tmpDir, 'src/content/articles'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('articlesはcategoryを含むURLを組み立てる', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'src/content/articles/my-slug.md'),
      '---\ntitle: "x"\ncategory: "gadget"\n---\n\n本文\n'
    );
    const url = buildProductionUrl(tmpDir, 'articles', 'my-slug');
    expect(url).toBe('https://hobnova.jp/gadget/my-slug/');
  });

  it('categoryが無ければnullを返す', () => {
    fs.writeFileSync(path.join(tmpDir, 'src/content/articles/no-category.md'), '---\ntitle: "x"\n---\n\n本文\n');
    expect(buildProductionUrl(tmpDir, 'articles', 'no-category')).toBeNull();
  });

  it('data-labはcategory不要で固定prefixのURLを組み立てる', () => {
    const url = buildProductionUrl(tmpDir, 'data-lab', 'my-data-slug');
    expect(url).toBe('https://hobnova.jp/data-lab/my-data-slug/');
  });

  it('toolsも固定prefixのURLを組み立てる', () => {
    const url = buildProductionUrl(tmpDir, 'tools', 'my-tool-slug');
    expect(url).toBe('https://hobnova.jp/tools/my-tool-slug/');
  });
});
