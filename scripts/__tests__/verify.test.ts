import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadArticleFile, writeArticleFile } from '../lib/image-pipeline/article-file';
import { verifyCoverImage, verifyInlineImages } from '../lib/image-pipeline/verify';

const SAMPLE_MARKDOWN = `---
title: "テスト記事"
description: "テストの説明文です。"
publishDate: 2026-10-01
category: "gadget"
tags: ["テスト"]
draft: false
---

本文です。![既存画像](/images/articles/test-article/inline-01.jpg)
`;

describe('verifyCoverImage', () => {
  let tmpDir: string;
  let articlePath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hobnova-verify-cover-'));
    articlePath = path.join(tmpDir, 'test-article.md');
    fs.writeFileSync(articlePath, SAMPLE_MARKDOWN, 'utf8');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('imageが未設定ならpresent: false、かつok: true', () => {
    const article = loadArticleFile(articlePath);
    const result = verifyCoverImage(article);
    expect(result.present).toBe(false);
    expect(result.ok).toBe(true);
  });

  it('画像ファイルが存在し拡張子も対応していればok: true', () => {
    fs.writeFileSync(path.join(tmpDir, 'test-article-hero.png'), 'fake-bytes');
    const article = loadArticleFile(articlePath);
    article.data.image = './test-article-hero.png';
    writeArticleFile(article);

    const reloaded = loadArticleFile(articlePath);
    const result = verifyCoverImage(reloaded);
    expect(result.present).toBe(true);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('frontmatterが参照するファイルが実在しなければエラーを返す', () => {
    const article = loadArticleFile(articlePath);
    article.data.image = './missing-hero.png';
    writeArticleFile(article);

    const reloaded = loadArticleFile(articlePath);
    const result = verifyCoverImage(reloaded);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('存在しません'))).toBe(true);
  });

  it('ファイルサイズが0ならエラーを返す', () => {
    fs.writeFileSync(path.join(tmpDir, 'test-article-hero.png'), '');
    const article = loadArticleFile(articlePath);
    article.data.image = './test-article-hero.png';
    writeArticleFile(article);

    const reloaded = loadArticleFile(articlePath);
    const result = verifyCoverImage(reloaded);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('サイズが0'))).toBe(true);
  });

  it('astro:assetsが未対応の拡張子はエラーを返す', () => {
    fs.writeFileSync(path.join(tmpDir, 'test-article-hero.bmp'), 'fake-bytes');
    const article = loadArticleFile(articlePath);
    article.data.image = './test-article-hero.bmp';
    writeArticleFile(article);

    const reloaded = loadArticleFile(articlePath);
    const result = verifyCoverImage(reloaded);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('未対応です'))).toBe(true);
  });
});

describe('verifyInlineImages', () => {
  let tmpDir: string;
  let articlePath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hobnova-verify-inline-'));
    fs.mkdirSync(path.join(tmpDir, 'public', 'images', 'articles', 'test-article'), { recursive: true });
    articlePath = path.join(tmpDir, 'test-article.md');
    fs.writeFileSync(articlePath, SAMPLE_MARKDOWN, 'utf8');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('実ファイルが存在し、本文に1回だけ参照されていればok: true', () => {
    const targetPath = path.join(tmpDir, 'public', 'images', 'articles', 'test-article', 'inline-01.jpg');
    fs.writeFileSync(targetPath, 'fake-bytes');
    const article = loadArticleFile(articlePath);

    const result = verifyInlineImages(article, [
      { targetPath, referencePath: '/images/articles/test-article/inline-01.jpg' },
    ]);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('実ファイルが存在しなければエラーを返す', () => {
    const targetPath = path.join(tmpDir, 'public', 'images', 'articles', 'test-article', 'inline-missing.jpg');
    const article = loadArticleFile(articlePath);

    const result = verifyInlineImages(article, [
      { targetPath, referencePath: '/images/articles/test-article/inline-missing.jpg' },
    ]);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('存在しません'))).toBe(true);
  });

  it('本文に参照が無ければエラーを返す', () => {
    const targetPath = path.join(tmpDir, 'public', 'images', 'articles', 'test-article', 'inline-02.jpg');
    fs.writeFileSync(targetPath, 'fake-bytes');
    const article = loadArticleFile(articlePath);

    const result = verifyInlineImages(article, [
      { targetPath, referencePath: '/images/articles/test-article/inline-02.jpg' },
    ]);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('参照がありません'))).toBe(true);
  });

  it('同じ画像が本文に二重挿入されていればエラーを返す', () => {
    const targetPath = path.join(tmpDir, 'public', 'images', 'articles', 'test-article', 'inline-01.jpg');
    fs.writeFileSync(targetPath, 'fake-bytes');
    const article = loadArticleFile(articlePath);
    article.body += '\n\n![重複](/images/articles/test-article/inline-01.jpg)\n';

    const result = verifyInlineImages(article, [
      { targetPath, referencePath: '/images/articles/test-article/inline-01.jpg' },
    ]);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('二重挿入'))).toBe(true);
  });
});
