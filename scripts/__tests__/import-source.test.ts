import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createLocalFileSource, resolveImageSource } from '../lib/image-pipeline/import-source';

const FIXTURES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

describe('resolveImageSource', () => {
  it('ローカルPNGファイルを読み込める', async () => {
    const result = await resolveImageSource(createLocalFileSource(path.join(FIXTURES_DIR, 'sample.png')));
    expect(result.ext).toBe('png');
    expect(result.buffer.length).toBeGreaterThan(0);
  });

  it('ローカルJPGファイルを読み込める', async () => {
    const result = await resolveImageSource(createLocalFileSource(path.join(FIXTURES_DIR, 'sample.jpg')));
    expect(result.ext).toBe('jpg');
  });

  it('存在しないファイルはエラー', async () => {
    await expect(resolveImageSource(createLocalFileSource(path.join(FIXTURES_DIR, 'nonexistent.png')))).rejects.toThrow(
      /not found/
    );
  });

  it('未対応拡張子はエラー', async () => {
    await expect(resolveImageSource(createLocalFileSource(path.join(FIXTURES_DIR, 'sample.txt')))).rejects.toThrow(
      /Unsupported image extension/
    );
  });
});
