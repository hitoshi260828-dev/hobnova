import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  hasExistingCover,
  hasExistingInlineImages,
  loadArticleFile,
  publicInlineImageDir,
  writeArticleFile,
} from '../lib/image-pipeline/article-file';
import { buildImagePlan } from '../lib/image-pipeline/plan';

const SAMPLE_MARKDOWN = `---
title: "テスト記事"
description: "テストの説明文です。十分な長さの説明文にします。"
publishDate: 2026-10-01
category: "gadget"
tags: ["テスト"]
draft: false
---

導入文です。

## 製品の比較ポイント

比較についての本文です。選択肢を具体的に説明する長い段落をここに書きます。

## まとめ

- まとめ1
`;

describe('article-file + plan integration', () => {
  let tmpDir: string;
  let articlePath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hobnova-image-test-'));
    fs.mkdirSync(path.join(tmpDir, 'public', 'images', 'articles'), { recursive: true });
    articlePath = path.join(tmpDir, 'test-article.md');
    fs.writeFileSync(articlePath, SAMPLE_MARKDOWN, 'utf8');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('画像未設定の記事では hasExistingCover が false', () => {
    const article = loadArticleFile(articlePath);
    expect(hasExistingCover(article)).toBe(false);
  });

  it('frontmatterにimageがあり実ファイルも存在すれば hasExistingCover が true', () => {
    fs.writeFileSync(path.join(tmpDir, 'test-article-hero.png'), 'fake');
    const article = loadArticleFile(articlePath);
    article.data.image = './test-article-hero.png';
    writeArticleFile(article);

    const reloaded = loadArticleFile(articlePath);
    expect(hasExistingCover(reloaded)).toBe(true);
  });

  it('frontmatterにimageがあってもファイルが無ければ hasExistingCover は false', () => {
    const article = loadArticleFile(articlePath);
    article.data.image = './missing-hero.png';
    writeArticleFile(article);

    const reloaded = loadArticleFile(articlePath);
    expect(hasExistingCover(reloaded)).toBe(false);
  });

  it('inline画像ディレクトリが無ければ hasExistingInlineImages は false', () => {
    expect(hasExistingInlineImages(tmpDir, 'test-article')).toBe(false);
  });

  it('inline-NN.jpgが存在すれば hasExistingInlineImages は true', () => {
    const dir = publicInlineImageDir(tmpDir, 'test-article');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'inline-01.jpg'), 'fake');
    expect(hasExistingInlineImages(tmpDir, 'test-article')).toBe(true);
  });

  it('既存画像がある場合、forceなしではplanがスキップを返す', () => {
    fs.writeFileSync(path.join(tmpDir, 'test-article-hero.png'), 'fake');
    const article = loadArticleFile(articlePath);
    article.data.image = './test-article-hero.png';
    writeArticleFile(article);

    const dir = publicInlineImageDir(tmpDir, 'test-article');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'inline-01.jpg'), 'fake');

    const reloaded = loadArticleFile(articlePath);
    const plan = buildImagePlan({
      article: reloaded,
      coverOnly: false,
      inlineOnly: false,
      hasExistingCover: hasExistingCover(reloaded),
      hasExistingInlineImages: hasExistingInlineImages(tmpDir, 'test-article'),
      force: false,
    });

    expect(plan.coverItem).toBeNull();
    expect(plan.inlineItems).toEqual([]);
    expect(plan.skippedCoverReason).toMatch(/スキップ/);
    expect(plan.skippedInlineReason).toMatch(/スキップ/);
  });

  it('--force指定時は既存画像があっても生成計画を作る（二重生成防止の解除）', () => {
    fs.writeFileSync(path.join(tmpDir, 'test-article-hero.png'), 'fake');
    const article = loadArticleFile(articlePath);
    article.data.image = './test-article-hero.png';
    writeArticleFile(article);

    const reloaded = loadArticleFile(articlePath);
    const plan = buildImagePlan({
      article: reloaded,
      coverOnly: false,
      inlineOnly: false,
      hasExistingCover: true,
      hasExistingInlineImages: false,
      force: true,
    });

    expect(plan.coverItem).not.toBeNull();
  });

  it('画像が何もない新規記事ではcover/inline両方の計画が作られる', () => {
    const article = loadArticleFile(articlePath);
    const plan = buildImagePlan({
      article,
      coverOnly: false,
      inlineOnly: false,
      hasExistingCover: false,
      hasExistingInlineImages: false,
      force: false,
    });

    expect(plan.coverItem).not.toBeNull();
    expect(plan.inlineItems.length).toBeGreaterThan(0);
    // 「まとめ」セクションは除外されているはず
    expect(plan.inlineItems.every((i) => i.heading !== 'まとめ')).toBe(true);
  });

  it('--cover-only では inlineItems が常に空になる', () => {
    const article = loadArticleFile(articlePath);
    const plan = buildImagePlan({
      article,
      coverOnly: true,
      inlineOnly: false,
      hasExistingCover: false,
      hasExistingInlineImages: false,
      force: false,
    });
    expect(plan.coverItem).not.toBeNull();
    expect(plan.inlineItems).toEqual([]);
  });

  it('--inline-only では coverItem が常にnullになる', () => {
    const article = loadArticleFile(articlePath);
    const plan = buildImagePlan({
      article,
      coverOnly: false,
      inlineOnly: true,
      hasExistingCover: false,
      hasExistingInlineImages: false,
      force: false,
    });
    expect(plan.coverItem).toBeNull();
    expect(plan.inlineItems.length).toBeGreaterThan(0);
  });
});
