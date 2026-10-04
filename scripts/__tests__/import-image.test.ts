import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadArticleFile } from '../lib/image-pipeline/article-file';
import { importCover, importInline, planImportCover, resolveInlineTarget } from '../lib/image-pipeline/import-image';

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

比較についての本文です。

## 使用シーンの紹介

使用シーンについての本文です。

## まとめ

- まとめ1
`;

const PNG_BUFFER = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const JPG_BUFFER = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=', 'base64');

describe('import-image integration', () => {
  let tmpDir: string;
  let articlePath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hobnova-import-test-'));
    fs.mkdirSync(path.join(tmpDir, 'public', 'images', 'articles'), { recursive: true });
    articlePath = path.join(tmpDir, 'test-article.md');
    fs.writeFileSync(articlePath, SAMPLE_MARKDOWN, 'utf8');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  describe('cover import', () => {
    it('新規カバーを取り込める（frontmatter更新・ファイル保存）', () => {
      const article = loadArticleFile(articlePath);
      const result = importCover({ article, buffer: PNG_BUFFER, ext: 'png', force: false, dryRun: false, copyOnly: false });

      expect(result.skipped).toBe(false);
      expect(fs.existsSync(result.targetPath)).toBe(true);

      const reloaded = loadArticleFile(articlePath);
      expect(reloaded.data.image).toBe('./test-article-hero.png');
    });

    it('dry-runでは何も書き換えない', () => {
      const article = loadArticleFile(articlePath);
      const plan = planImportCover(article, 'png', false);
      const result = importCover({ article, buffer: PNG_BUFFER, ext: 'png', force: false, dryRun: true, copyOnly: false });

      expect(result.targetPath).toBe(plan.targetPath);
      expect(fs.existsSync(plan.targetPath)).toBe(false);
      expect(loadArticleFile(articlePath).data.image).toBeUndefined();
    });

    it('既存カバーがあればforce無しでスキップする', () => {
      const article1 = loadArticleFile(articlePath);
      importCover({ article: article1, buffer: PNG_BUFFER, ext: 'png', force: false, dryRun: false, copyOnly: false });

      const article2 = loadArticleFile(articlePath);
      const result = importCover({ article: article2, buffer: JPG_BUFFER, ext: 'jpg', force: false, dryRun: false, copyOnly: false });

      expect(result.skipped).toBe(true);
      expect(loadArticleFile(articlePath).data.image).toBe('./test-article-hero.png');
    });

    it('--forceで上書きでき、拡張子が変わる場合は古いファイルを削除する', () => {
      const article1 = loadArticleFile(articlePath);
      const first = importCover({ article: article1, buffer: PNG_BUFFER, ext: 'png', force: false, dryRun: false, copyOnly: false });
      expect(fs.existsSync(first.targetPath)).toBe(true);

      const article2 = loadArticleFile(articlePath);
      const second = importCover({ article: article2, buffer: JPG_BUFFER, ext: 'jpg', force: true, dryRun: false, copyOnly: false });

      expect(second.skipped).toBe(false);
      expect(fs.existsSync(second.targetPath)).toBe(true);
      expect(fs.existsSync(first.targetPath)).toBe(false); // 古い.pngは削除される
      expect(loadArticleFile(articlePath).data.image).toBe('./test-article-hero.jpg');
    });

    it('--copy-onlyはファイル保存のみでfrontmatterを更新しない', () => {
      const article = loadArticleFile(articlePath);
      const result = importCover({ article, buffer: PNG_BUFFER, ext: 'png', force: false, dryRun: false, copyOnly: true });

      expect(result.copyOnly).toBe(true);
      expect(fs.existsSync(result.targetPath)).toBe(true);
      expect(loadArticleFile(articlePath).data.image).toBeUndefined();
    });

    it('記事更新に失敗した場合、コピーした画像をロールバック（削除）する', () => {
      const article = loadArticleFile(articlePath);
      const plan = planImportCover(article, 'png', false);

      const realWriteFileSync = fs.writeFileSync.bind(fs);
      vi.spyOn(fs, 'writeFileSync').mockImplementation(((target: fs.PathOrFileDescriptor, data: unknown) => {
        if (target === article.absolutePath) {
          throw new Error('simulated write failure');
        }
        return realWriteFileSync(target as never, data as never);
      }) as typeof fs.writeFileSync);

      expect(() =>
        importCover({ article, buffer: PNG_BUFFER, ext: 'png', force: false, dryRun: false, copyOnly: false })
      ).toThrow(/simulated write failure/);

      expect(fs.existsSync(plan.targetPath)).toBe(false); // ロールバックされている
    });
  });

  describe('inline import', () => {
    it('--after-headingで指定セクション直後へ挿入できる', () => {
      const article = loadArticleFile(articlePath);
      const result = importInline({
        article,
        repoRoot: tmpDir,
        buffer: JPG_BUFFER,
        ext: 'jpg',
        afterHeading: '製品の比較ポイント',
        force: false,
        dryRun: false,
        copyOnly: false,
      });

      expect(result.skipped).toBe(false);
      expect(result.referencePath).toBe('/images/articles/test-article/inline-01.jpg');
      expect(fs.existsSync(result.targetPath)).toBe(true);

      const reloaded = loadArticleFile(articlePath);
      expect(reloaded.body).toContain('](/images/articles/test-article/inline-01.jpg)');
      const insertIndex = reloaded.body.indexOf('inline-01.jpg');
      const sectionIndex = reloaded.body.indexOf('比較についての本文');
      expect(insertIndex).toBeLessThan(sectionIndex);
    });

    it('--positionで番号指定したセクション直後へ挿入できる', () => {
      const article = loadArticleFile(articlePath);
      const result = importInline({
        article,
        repoRoot: tmpDir,
        buffer: JPG_BUFFER,
        ext: 'jpg',
        position: 2,
        force: false,
        dryRun: false,
        copyOnly: false,
      });

      const reloaded = loadArticleFile(articlePath);
      const insertIndex = reloaded.body.indexOf(result.referencePath!);
      const sceneIndex = reloaded.body.indexOf('使用シーンについての本文');
      expect(insertIndex).toBeLessThan(sceneIndex);
    });

    it('--altを指定すればそのまま使う', () => {
      const article = loadArticleFile(articlePath);
      const result = importInline({
        article,
        repoRoot: tmpDir,
        buffer: JPG_BUFFER,
        ext: 'jpg',
        position: 1,
        alt: 'カスタムalt文字列',
        force: false,
        dryRun: false,
        copyOnly: false,
      });

      expect(result.alt).toBe('カスタムalt文字列');
    });

    it('--alt未指定ならタイトル・見出しからルールベースで自動生成する', () => {
      const article = loadArticleFile(articlePath);
      const result = importInline({
        article,
        repoRoot: tmpDir,
        buffer: JPG_BUFFER,
        ext: 'jpg',
        afterHeading: '製品の比較ポイント',
        force: false,
        dryRun: false,
        copyOnly: false,
      });

      expect(result.alt).not.toBe('記事画像');
      expect(result.alt).toContain('製品の比較ポイント');
      expect(result.alt).toContain('テスト記事');
    });

    it('見出しが見つからなければエラー', () => {
      const article = loadArticleFile(articlePath);
      expect(() =>
        importInline({
          article,
          repoRoot: tmpDir,
          buffer: JPG_BUFFER,
          ext: 'jpg',
          afterHeading: '存在しない見出し',
          force: false,
          dryRun: false,
          copyOnly: false,
        })
      ).toThrow(/見出しが見つかりません/);
    });

    it('positionが範囲外ならエラー', () => {
      const article = loadArticleFile(articlePath);
      expect(() =>
        importInline({
          article,
          repoRoot: tmpDir,
          buffer: JPG_BUFFER,
          ext: 'jpg',
          position: 99,
          force: false,
          dryRun: false,
          copyOnly: false,
        })
      ).toThrow(/--position が不正です/);
    });

    it('after-headingもpositionも無ければエラー', () => {
      const article = loadArticleFile(articlePath);
      expect(() =>
        resolveInlineTarget({ article, repoRoot: tmpDir, ext: 'jpg' })
      ).toThrow(/--after-heading または --position/);
    });

    it('連続インポートで採番が重複しない', () => {
      const article1 = loadArticleFile(articlePath);
      const r1 = importInline({ article: article1, repoRoot: tmpDir, buffer: JPG_BUFFER, ext: 'jpg', position: 1, force: false, dryRun: false, copyOnly: false });

      const article2 = loadArticleFile(articlePath);
      const r2 = importInline({ article: article2, repoRoot: tmpDir, buffer: JPG_BUFFER, ext: 'jpg', position: 2, force: false, dryRun: false, copyOnly: false });

      expect(r1.referencePath).toBe('/images/articles/test-article/inline-01.jpg');
      expect(r2.referencePath).toBe('/images/articles/test-article/inline-02.jpg');
    });

    it('同じ画像パスが既に本文にある場合、force無しではスキップする（二重挿入防止）', () => {
      const article = loadArticleFile(articlePath);
      const resolution = resolveInlineTarget({ article, repoRoot: tmpDir, ext: 'jpg', position: 1 });

      // 事前に同じreferencePathを本文へ手動で仕込んでおく。
      article.body += `\n\n![既存](${resolution.referencePath})\n`;

      const result = importInline({
        article,
        repoRoot: tmpDir,
        buffer: JPG_BUFFER,
        ext: 'jpg',
        position: 1,
        force: false,
        dryRun: false,
        copyOnly: false,
      });

      expect(result.skipped).toBe(true);
    });

    it('dry-runでは画像ファイルも本文も変更しない', () => {
      const article = loadArticleFile(articlePath);
      const before = article.body;
      const result = importInline({
        article,
        repoRoot: tmpDir,
        buffer: JPG_BUFFER,
        ext: 'jpg',
        position: 1,
        force: false,
        dryRun: true,
        copyOnly: false,
      });

      expect(fs.existsSync(result.targetPath)).toBe(false);
      expect(loadArticleFile(articlePath).body).toBe(before);
    });

    it('--copy-onlyは画像ファイルのみ保存し、本文は変更しない', () => {
      const article = loadArticleFile(articlePath);
      const before = article.body;
      const result = importInline({
        article,
        repoRoot: tmpDir,
        buffer: JPG_BUFFER,
        ext: 'jpg',
        position: 1,
        force: false,
        dryRun: false,
        copyOnly: true,
      });

      expect(fs.existsSync(result.targetPath)).toBe(true);
      expect(loadArticleFile(articlePath).body).toBe(before);
    });
  });
});
