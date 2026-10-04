import { describe, expect, it } from 'vitest';
import { parseArgs } from '../lib/image-pipeline/cli-args';

describe('parseArgs', () => {
  it('記事パスとフラグを正しく解釈する', () => {
    const options = parseArgs(['article.md', '--dry-run', '--force']);
    expect(options).toEqual({
      articlePath: 'article.md',
      force: true,
      coverOnly: false,
      inlineOnly: false,
      dryRun: true,
    });
  });

  it('記事パスが無い場合はエラー', () => {
    expect(() => parseArgs(['--dry-run'])).toThrow();
  });

  it('記事パスが複数ある場合はエラー', () => {
    expect(() => parseArgs(['a.md', 'b.md'])).toThrow();
  });

  it('--cover-only と --inline-only の同時指定はエラー', () => {
    expect(() => parseArgs(['a.md', '--cover-only', '--inline-only'])).toThrow();
  });

  it('--cover-only のみは許可される', () => {
    const options = parseArgs(['a.md', '--cover-only']);
    expect(options.coverOnly).toBe(true);
    expect(options.inlineOnly).toBe(false);
  });
});
