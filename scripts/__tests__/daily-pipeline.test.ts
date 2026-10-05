import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runImageGenerationPlanMock = vi.fn();

vi.mock('../lib/image-pipeline/run-image-generation', () => ({
  runImageGenerationPlan: runImageGenerationPlanMock,
}));

const { runDailyArticlePipeline } = await import('../lib/image-pipeline/daily-pipeline');

const SAMPLE_MARKDOWN = (draft: boolean) => `---
title: "テスト記事"
description: "テストの説明文です。十分な長さの説明文にします。"
publishDate: 2026-10-01
category: "gadget"
tags: ["テスト"]
draft: ${draft}
---

導入文です。

## 製品の比較ポイント

比較についての本文です。選択肢を具体的に説明する長い段落をここに書きます。

## まとめ

- まとめ1
`;

const EMPTY_GENERATION_RESULT = {
  cover: { status: 'not-planned' },
  inline: { status: 'not-planned', succeeded: 0, failed: 0, outcomes: [] },
  articleUpdated: false,
};

describe('runDailyArticlePipeline', () => {
  let tmpDir: string;
  let articlePath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hobnova-daily-pipeline-'));
    fs.mkdirSync(path.join(tmpDir, 'public', 'images', 'articles'), { recursive: true });
    articlePath = path.join(tmpDir, 'test-article.md');
    fs.writeFileSync(articlePath, SAMPLE_MARKDOWN(false), 'utf8');
    runImageGenerationPlanMock.mockReset();
    runImageGenerationPlanMock.mockResolvedValue(EMPTY_GENERATION_RESULT);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('article pathが不正なら明確なエラーで失敗する', async () => {
    await expect(
      runDailyArticlePipeline({
        articlePath: path.join(tmpDir, 'does-not-exist.md'),
        repoRoot: tmpDir,
        dryRun: false,
        force: false,
        coverOnly: false,
        inlineOnly: false,
      })
    ).rejects.toThrow(/Article file not found/);
  });

  it('--dry-runでは画像生成・astro check・build・git statusを一切実行しない', async () => {
    const runCommand = vi.fn();
    const result = await runDailyArticlePipeline({
      articlePath,
      repoRoot: tmpDir,
      dryRun: true,
      force: false,
      coverOnly: false,
      inlineOnly: false,
      runCommand,
    });

    expect(runImageGenerationPlanMock).not.toHaveBeenCalled();
    expect(runCommand).not.toHaveBeenCalled();
    expect(result.generation).toBeNull();
    expect(result.astroCheck.status).toBe('skipped');
    expect(result.build.status).toBe('skipped');
    expect(result.gitStatus).toBeNull();
    // plan計算自体は行われる
    expect(result.plan.coverItem).not.toBeNull();
  });

  it('draft:true の記事でも画像生成は実行され、draftフラグは変更されない', async () => {
    fs.writeFileSync(articlePath, SAMPLE_MARKDOWN(true), 'utf8');
    const runCommand = vi.fn().mockReturnValue('');

    const result = await runDailyArticlePipeline({
      articlePath,
      repoRoot: tmpDir,
      dryRun: false,
      force: false,
      coverOnly: false,
      inlineOnly: false,
      runCommand,
    });

    expect(result.draft).toBe(true);
    expect(runImageGenerationPlanMock).toHaveBeenCalledTimes(1);
    expect(result.article.data.draft).toBe(true);
  });

  it('astro check・build・git statusへ正しいコマンド・引数・cwdを渡す', async () => {
    const runCommand = vi.fn().mockReturnValue('');

    await runDailyArticlePipeline({
      articlePath,
      repoRoot: tmpDir,
      dryRun: false,
      force: false,
      coverOnly: false,
      inlineOnly: false,
      runCommand,
    });

    expect(runCommand).toHaveBeenNthCalledWith(1, 'npx', ['astro', 'check'], tmpDir);
    expect(runCommand).toHaveBeenNthCalledWith(2, 'npm', ['run', 'build'], tmpDir);

    // inline画像ディレクトリは作っていないため、pathspecには記事ファイルのみを渡す
    // （存在しないパスをgitのpathspecに渡すと `did not match any files` で失敗するため）。
    const [gitCommand, gitArgs, gitCwd] = runCommand.mock.calls[2];
    expect(gitCommand).toBe('git');
    expect(gitArgs[0]).toBe('status');
    expect(gitArgs).toContain('--short');
    expect(gitArgs).toContain(articlePath);
    expect(gitArgs).not.toContain(path.join(tmpDir, 'public', 'images', 'articles', 'test-article'));
    expect(gitCwd).toBe(tmpDir);
  });

  it('inline画像ディレクトリが存在する場合はgit statusのpathspecに含める', async () => {
    const inlineDir = path.join(tmpDir, 'public', 'images', 'articles', 'test-article');
    fs.mkdirSync(inlineDir, { recursive: true });
    fs.writeFileSync(path.join(inlineDir, 'inline-01.jpg'), 'fake-bytes');
    const runCommand = vi.fn().mockReturnValue('');

    await runDailyArticlePipeline({
      articlePath,
      repoRoot: tmpDir,
      dryRun: false,
      force: false,
      coverOnly: false,
      inlineOnly: false,
      runCommand,
    });

    const [, gitArgs] = runCommand.mock.calls[2];
    expect(gitArgs).toContain(inlineDir);
  });

  it('astro checkが失敗してもbuildは続行して実行される', async () => {
    const runCommand = vi
      .fn()
      .mockImplementationOnce(() => {
        const err = new Error('astro check failed') as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
        err.stdout = 'type error in foo.astro';
        throw err;
      })
      .mockImplementationOnce(() => 'build output ok')
      .mockImplementationOnce(() => '');

    const result = await runDailyArticlePipeline({
      articlePath,
      repoRoot: tmpDir,
      dryRun: false,
      force: false,
      coverOnly: false,
      inlineOnly: false,
      runCommand,
    });

    expect(result.astroCheck.status).toBe('fail');
    expect(result.astroCheck.output).toContain('type error in foo.astro');
    expect(result.build.status).toBe('pass');
    expect(runCommand).toHaveBeenCalledTimes(3); // astro check, build, git status
  });

  it('buildが失敗してもgit statusは取得され、全体は例外を投げない', async () => {
    const runCommand = vi
      .fn()
      .mockImplementationOnce(() => '') // astro check: pass
      .mockImplementationOnce(() => {
        throw new Error('build failed: module not found');
      })
      .mockImplementationOnce(() => ' M test-article.md\n');

    const result = await runDailyArticlePipeline({
      articlePath,
      repoRoot: tmpDir,
      dryRun: false,
      force: false,
      coverOnly: false,
      inlineOnly: false,
      runCommand,
    });

    expect(result.astroCheck.status).toBe('pass');
    expect(result.build.status).toBe('fail');
    expect(result.build.output).toContain('module not found');
    expect(result.gitStatus).toContain('test-article.md');
  });

  it('画像生成結果に応じてcover/inlineの品質検証結果を返す', async () => {
    const coverPath = path.join(tmpDir, 'test-article-hero.png');
    fs.writeFileSync(coverPath, 'fake-cover-bytes');

    // 実際のrunImageGenerationPlanはcover生成成功時にarticle.data.imageを書き換える。
    // このテストではその副作用だけを再現し、verify.tsが正しく参照できるか確認する。
    runImageGenerationPlanMock.mockImplementation(async (article: { data: Record<string, unknown> }) => {
      article.data.image = './test-article-hero.png';
      return {
        cover: { status: 'success', targetPath: coverPath },
        inline: { status: 'not-planned', succeeded: 0, failed: 0, outcomes: [] },
        articleUpdated: true,
      };
    });
    const runCommand = vi.fn().mockReturnValue('');

    const result = await runDailyArticlePipeline({
      articlePath,
      repoRoot: tmpDir,
      dryRun: false,
      force: false,
      coverOnly: true,
      inlineOnly: false,
      runCommand,
    });

    expect(result.verification).not.toBeNull();
    expect(result.verification!.cover.present).toBe(true);
    expect(result.verification!.cover.ok).toBe(true);
    expect(result.verification!.cover.errors).toEqual([]);
  });
});
