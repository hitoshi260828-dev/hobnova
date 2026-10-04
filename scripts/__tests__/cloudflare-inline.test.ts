import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateInlineImage } from '../lib/image-pipeline/cloudflare-inline';

const CONFIG = { accountId: 'acc', apiToken: 'token', model: '@cf/test-model' };

describe('generateInlineImage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('成功時はbase64をデコードしてBufferを返す', async () => {
    const base64 = Buffer.from('fake-image-bytes').toString('base64');
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ result: { image: base64 } }),
    });

    const result = await generateInlineImage('prompt', CONFIG);
    expect(result.ext).toBe('jpg');
    expect(result.buffer.toString()).toBe('fake-image-bytes');
  });

  it('トップレベルのimageフィールドにも対応する', async () => {
    const base64 = Buffer.from('top-level').toString('base64');
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ image: base64 }),
    });

    const result = await generateInlineImage('prompt', CONFIG);
    expect(result.buffer.toString()).toBe('top-level');
  });

  it('HTTP 401は最終的にエラーを投げる（リトライで回復しない想定）', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ errors: [{ code: 10000, message: 'Authentication error' }] }),
    });

    await expect(generateInlineImage('prompt', CONFIG)).rejects.toThrow(/401/);
  }, 10000);

  it('HTTP 429は最大2回までリトライしてから失敗する', async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ errors: [{ message: 'rate limited' }] }),
    });

    await expect(generateInlineImage('prompt', CONFIG)).rejects.toThrow(/429/);
    expect(mockFetch).toHaveBeenCalledTimes(3); // 初回 + リトライ2回
  }, 10000);

  it('HTTP 500でもエラーメッセージにステータスを含める', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    });

    await expect(generateInlineImage('prompt', CONFIG)).rejects.toThrow(/500/);
  }, 10000);

  it('画像データが欠落している場合はエラーを投げる', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ result: {} }),
    });

    await expect(generateInlineImage('prompt', CONFIG)).rejects.toThrow(/no image data/);
  }, 10000);
});
