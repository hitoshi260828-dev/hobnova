import { describe, expect, it, vi, beforeEach } from 'vitest';

const generateMock = vi.fn();

vi.mock('openai', () => ({
  default: class MockOpenAI {
    images = { generate: generateMock };
  },
}));

const { generateCoverImage, resolveOpenAiImageModel, DEFAULT_OPENAI_IMAGE_MODEL } = await import(
  '../lib/image-pipeline/openai-cover'
);

describe('generateCoverImage', () => {
  beforeEach(() => {
    generateMock.mockReset();
  });

  it('成功時はb64_jsonをデコードしてPNGとして返す', async () => {
    const base64 = Buffer.from('fake-png-bytes').toString('base64');
    generateMock.mockResolvedValue({ data: [{ b64_json: base64 }] });

    const result = await generateCoverImage('prompt', { apiKey: 'key', model: 'gpt-image-1' });
    expect(result.ext).toBe('png');
    expect(result.buffer.toString()).toBe('fake-png-bytes');
  });

  it('b64_jsonが無い場合はエラーを投げる', async () => {
    generateMock.mockResolvedValue({ data: [{}] });
    await expect(generateCoverImage('prompt', { apiKey: 'key', model: 'gpt-image-1' })).rejects.toThrow(
      /no image data/
    );
  }, 10000);

  it('API 401等の失敗は最大2回リトライしてから失敗する', async () => {
    generateMock.mockRejectedValue(new Error('401 Unauthorized'));
    await expect(generateCoverImage('prompt', { apiKey: 'bad', model: 'gpt-image-1' })).rejects.toThrow(
      /401/
    );
    expect(generateMock).toHaveBeenCalledTimes(3);
  }, 10000);
});

describe('resolveOpenAiImageModel', () => {
  it('環境変数が未設定ならデフォルトモデルを返す', () => {
    expect(resolveOpenAiImageModel({})).toBe(DEFAULT_OPENAI_IMAGE_MODEL);
  });

  it('環境変数が設定されていればそれを使う', () => {
    expect(resolveOpenAiImageModel({ OPENAI_IMAGE_MODEL: 'custom-model' })).toBe('custom-model');
  });
});
