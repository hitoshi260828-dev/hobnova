import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadArticleFile, publicInlineImageDir } from '../lib/image-pipeline/article-file';
import { buildImagePlan } from '../lib/image-pipeline/plan';

const generateCoverImageMock = vi.fn();
const generateInlineImageMock = vi.fn();

vi.mock('../lib/image-pipeline/openai-cover', () => ({
  generateCoverImage: generateCoverImageMock,
  resolveOpenAiImageModel: () => 'gpt-image-1',
}));

vi.mock('../lib/image-pipeline/cloudflare-inline', () => ({
  generateInlineImage: generateInlineImageMock,
  resolveCloudflareImageModel: () => '@cf/black-forest-labs/flux-2-dev',
  resolveCloudflareImageGuidance: () => undefined,
  resolveCloudflareImageSteps: () => 25,
}));

const { runImageGenerationPlan } = await import('../lib/image-pipeline/run-image-generation');

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

比較についての本文です。選択肢を具体的に説明する長い段落をここに書きます。${'比較対象の仕様や価格、使い勝手の違いを詳しく解説する補足文です。'.repeat(30)}

## 使用シーンの紹介

使用シーンについての本文です。選択肢を具体的に説明する長い段落をここに書きます。${'実際の利用シーンや活用方法を詳しく解説する補足文です。'.repeat(30)}

## まとめ

- まとめ1
`;

describe('runImageGenerationPlan', () => {
  let tmpDir: string;
  let articlePath: string;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hobnova-run-image-gen-'));
    fs.mkdirSync(path.join(tmpDir, 'public', 'images', 'articles'), { recursive: true });
    articlePath = path.join(tmpDir, 'test-article.md');
    fs.writeFileSync(articlePath, SAMPLE_MARKDOWN, 'utf8');

    generateCoverImageMock.mockReset();
    generateInlineImageMock.mockReset();
    process.env.OPENAI_API_KEY = 'test-openai-key';
    process.env.CLOUDFLARE_ACCOUNT_ID = 'test-account';
    process.env.CLOUDFLARE_API_TOKEN = 'test-token';
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    process.env = { ...originalEnv };
  });

  function plan(article: ReturnType<typeof loadArticleFile>, overrides: Partial<Parameters<typeof buildImagePlan>[0]> = {}) {
    return buildImagePlan({
      article,
      coverOnly: false,
      inlineOnly: false,
      hasExistingCover: false,
      hasExistingInlineImages: false,
      force: false,
      ...overrides,
    });
  }

  it('cover・inlineともに成功すればarticleが更新される', async () => {
    const article = loadArticleFile(articlePath);
    generateCoverImageMock.mockResolvedValue({ buffer: Buffer.from('cover-bytes'), ext: 'png' });
    generateInlineImageMock.mockResolvedValue({ buffer: Buffer.from('inline-bytes'), ext: 'jpg' });

    const result = await runImageGenerationPlan(article, tmpDir, plan(article));

    expect(result.cover.status).toBe('success');
    expect(result.inline.status).toBe('success');
    expect(result.inline.succeeded).toBe(2);
    expect(result.articleUpdated).toBe(true);
    expect(article.data.image).toMatch(/test-article-hero\.png$/);
    expect(fs.existsSync(result.cover.targetPath!)).toBe(true);
  });

  it('OPENAI_API_KEY未設定ならcoverはfailed扱いで、記事本文は壊さない', async () => {
    delete process.env.OPENAI_API_KEY;
    const article = loadArticleFile(articlePath);
    generateInlineImageMock.mockResolvedValue({ buffer: Buffer.from('inline-bytes'), ext: 'jpg' });

    const result = await runImageGenerationPlan(article, tmpDir, plan(article));

    expect(result.cover.status).toBe('failed');
    expect(result.cover.error).toMatch(/OPENAI_API_KEY/);
    expect(article.data.image).toBeUndefined();
    // inlineは成功しているので記事は更新される
    expect(result.articleUpdated).toBe(true);
  });

  it('OpenAI呼び出しが例外を投げてもinline生成は続行する', async () => {
    const article = loadArticleFile(articlePath);
    generateCoverImageMock.mockRejectedValue(new Error('OpenAI 429 no credits'));
    generateInlineImageMock.mockResolvedValue({ buffer: Buffer.from('inline-bytes'), ext: 'jpg' });

    const result = await runImageGenerationPlan(article, tmpDir, plan(article));

    expect(result.cover.status).toBe('failed');
    expect(result.cover.error).toMatch(/429/);
    expect(result.inline.succeeded).toBe(2);
  });

  it('CLOUDFLARE認証情報が未設定ならinlineは全件failedになるがcoverは続行する', async () => {
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
    delete process.env.CLOUDFLARE_API_TOKEN;
    const article = loadArticleFile(articlePath);
    generateCoverImageMock.mockResolvedValue({ buffer: Buffer.from('cover-bytes'), ext: 'png' });

    const result = await runImageGenerationPlan(article, tmpDir, plan(article));

    expect(result.cover.status).toBe('success');
    expect(result.inline.status).toBe('failed');
    expect(result.inline.succeeded).toBe(0);
    expect(result.inline.failed).toBe(2);
    expect(result.inline.outcomes.every((o) => /CLOUDFLARE_ACCOUNT_ID/.test(o.error ?? ''))).toBe(true);
    expect(result.inline.reason).toMatch(/CLOUDFLARE_ACCOUNT_ID/);
  });

  it('inline画像が1枚失敗・1枚成功なら部分成功(partial)として報告し、成功分だけ本文に挿入する', async () => {
    const article = loadArticleFile(articlePath);
    generateCoverImageMock.mockResolvedValue({ buffer: Buffer.from('cover-bytes'), ext: 'png' });
    generateInlineImageMock
      .mockResolvedValueOnce({ buffer: Buffer.from('inline-bytes'), ext: 'jpg' })
      .mockRejectedValueOnce(new Error('Cloudflare Workers AI request failed: HTTP 500'));

    const result = await runImageGenerationPlan(article, tmpDir, plan(article));

    expect(result.inline.status).toBe('partial');
    expect(result.inline.succeeded).toBe(1);
    expect(result.inline.failed).toBe(1);
    expect(article.body.match(/inline-01\.jpg/g)?.length).toBe(1);
    expect(article.body).not.toContain('inline-02.jpg');
  });

  it('既存画像によりplanがスキップされている場合はnot-plannedではなくskippedを返す', async () => {
    const article = loadArticleFile(articlePath);
    const skippedPlan = plan(article, { hasExistingCover: true, hasExistingInlineImages: true });

    const result = await runImageGenerationPlan(article, tmpDir, skippedPlan);

    expect(result.cover.status).toBe('skipped');
    expect(result.inline.status).toBe('skipped');
    expect(result.articleUpdated).toBe(false);
    expect(generateCoverImageMock).not.toHaveBeenCalled();
    expect(generateInlineImageMock).not.toHaveBeenCalled();
  });

  it('--cover-onlyではinlineがnot-plannedになる', async () => {
    const article = loadArticleFile(articlePath);
    generateCoverImageMock.mockResolvedValue({ buffer: Buffer.from('cover-bytes'), ext: 'png' });
    const coverOnlyPlan = plan(article, { coverOnly: true });

    const result = await runImageGenerationPlan(article, tmpDir, coverOnlyPlan);

    expect(result.inline.status).toBe('not-planned');
    expect(generateInlineImageMock).not.toHaveBeenCalled();
  });

  it('生成した本文画像は publicInlineImageDir 配下に保存される', async () => {
    const article = loadArticleFile(articlePath);
    generateInlineImageMock.mockResolvedValue({ buffer: Buffer.from('inline-bytes'), ext: 'jpg' });
    const inlineOnlyPlan = plan(article, { inlineOnly: true });

    const result = await runImageGenerationPlan(article, tmpDir, inlineOnlyPlan);

    const dir = publicInlineImageDir(tmpDir, article.slug);
    const success = result.inline.outcomes.find((o) => o.status === 'success');
    expect(success?.targetPath?.startsWith(dir)).toBe(true);
    expect(fs.existsSync(success!.targetPath!)).toBe(true);
  });
});
