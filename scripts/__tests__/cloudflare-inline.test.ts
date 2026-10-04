import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  generateInlineImage,
  requiresMultipart,
  resolveCloudflareImageModel,
  resolveCloudflareImageSteps,
} from '../lib/image-pipeline/cloudflare-inline';

const MULTIPART_CONFIG = { accountId: 'acc', apiToken: 'token', model: '@cf/black-forest-labs/flux-2-dev' };
const JSON_CONFIG = { accountId: 'acc', apiToken: 'token', model: '@cf/black-forest-labs/flux-1-schnell' };
const KLEIN_CONFIG = { accountId: 'acc', apiToken: 'token', model: '@cf/black-forest-labs/flux-2-klein-9b' };

function mockJsonResponse(ok: boolean, status: number, data: unknown) {
  const text = JSON.stringify(data);
  return { ok, status, json: async () => data, text: async () => text };
}

describe('requiresMultipart', () => {
  it('flux-2系モデルはmultipart判定', () => {
    expect(requiresMultipart('@cf/black-forest-labs/flux-2-dev')).toBe(true);
    expect(requiresMultipart('@cf/black-forest-labs/flux-2-klein-9b')).toBe(true);
  });

  it('flux-1-schnell等の旧世代モデルはJSON判定', () => {
    expect(requiresMultipart('@cf/black-forest-labs/flux-1-schnell')).toBe(false);
  });
});

describe('resolveCloudflareImageModel', () => {
  it('既定値はflux-2-dev', () => {
    expect(resolveCloudflareImageModel({})).toBe('@cf/black-forest-labs/flux-2-dev');
  });

  it('環境変数で明示指定すればklein-9b等へ切り替え可能', () => {
    expect(resolveCloudflareImageModel({ CLOUDFLARE_IMAGE_MODEL: '@cf/black-forest-labs/flux-2-klein-9b' })).toBe(
      '@cf/black-forest-labs/flux-2-klein-9b'
    );
  });
});

describe('resolveCloudflareImageSteps', () => {
  it('未設定なら既定値25', () => {
    expect(resolveCloudflareImageSteps({})).toBe(25);
  });

  it('有効な値はそのまま使う', () => {
    expect(resolveCloudflareImageSteps({ CLOUDFLARE_IMAGE_STEPS: '10' })).toBe(10);
    expect(resolveCloudflareImageSteps({ CLOUDFLARE_IMAGE_STEPS: '50' })).toBe(50);
    expect(resolveCloudflareImageSteps({ CLOUDFLARE_IMAGE_STEPS: '1' })).toBe(1);
  });

  it('範囲外・不正値は既定値25へフォールバックする', () => {
    expect(resolveCloudflareImageSteps({ CLOUDFLARE_IMAGE_STEPS: '0' })).toBe(25);
    expect(resolveCloudflareImageSteps({ CLOUDFLARE_IMAGE_STEPS: '51' })).toBe(25);
    expect(resolveCloudflareImageSteps({ CLOUDFLARE_IMAGE_STEPS: '-5' })).toBe(25);
    expect(resolveCloudflareImageSteps({ CLOUDFLARE_IMAGE_STEPS: 'abc' })).toBe(25);
    expect(resolveCloudflareImageSteps({ CLOUDFLARE_IMAGE_STEPS: '' })).toBe(25);
  });
});

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
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(mockJsonResponse(true, 200, { result: { image: base64 } }));

    const result = await generateInlineImage('prompt', MULTIPART_CONFIG);
    expect(result.ext).toBe('jpg');
    expect(result.buffer.toString()).toBe('fake-image-bytes');
  });

  it('flux-2系はmultipart/form-data（FormData）でprompt/width/height/stepsを送信し、Content-Typeは手動設定しない', async () => {
    const base64 = Buffer.from('x').toString('base64');
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValue(mockJsonResponse(true, 200, { result: { image: base64 } }));

    await generateInlineImage('テスト用プロンプト', {
      ...MULTIPART_CONFIG,
      width: 1024,
      height: 1024,
      guidance: 3.5,
      steps: 25,
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(String(url)).toContain(MULTIPART_CONFIG.model);
    expect(init.body).toBeInstanceOf(FormData);
    expect(init.headers['content-type']).toBeUndefined();

    const form = init.body as FormData;
    expect(form.get('prompt')).toBe('テスト用プロンプト');
    expect(form.get('width')).toBe('1024');
    expect(form.get('height')).toBe('1024');
    expect(form.get('guidance')).toBe('3.5');
    expect(form.get('steps')).toBe('25');
  });

  it('guidanceを渡さなければFormDataに含めない', async () => {
    const base64 = Buffer.from('x').toString('base64');
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValue(mockJsonResponse(true, 200, { result: { image: base64 } }));

    await generateInlineImage('p', MULTIPART_CONFIG);

    const [, init] = mockFetch.mock.calls[0];
    const form = init.body as FormData;
    expect(form.get('guidance')).toBeNull();
  });

  it('klein系はsteps固定のため、stepsを渡してもFormDataへ含めない', async () => {
    const base64 = Buffer.from('x').toString('base64');
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValue(mockJsonResponse(true, 200, { result: { image: base64 } }));

    await generateInlineImage('p', { ...KLEIN_CONFIG, steps: 25 });

    const [, init] = mockFetch.mock.calls[0];
    const form = init.body as FormData;
    expect(form.get('steps')).toBeNull();
  });

  it('flux-1-schnell等はJSON bodyでpromptのみ送信する', async () => {
    const base64 = Buffer.from('x').toString('base64');
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValue(mockJsonResponse(true, 200, { result: { image: base64 } }));

    await generateInlineImage('JSON用プロンプト', { ...JSON_CONFIG, width: 1024, height: 1024, steps: 25 });

    const [url, init] = mockFetch.mock.calls[0];
    expect(String(url)).toContain(JSON_CONFIG.model);
    expect(init.headers['content-type']).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual({ prompt: 'JSON用プロンプト' });
  });

  it('トップレベルのimageフィールドにも対応する', async () => {
    const base64 = Buffer.from('top-level').toString('base64');
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(mockJsonResponse(true, 200, { image: base64 }));

    const result = await generateInlineImage('prompt', MULTIPART_CONFIG);
    expect(result.buffer.toString()).toBe('top-level');
  });

  it('HTTP 401は最終的にエラーを投げる（リトライで回復しない想定）', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockJsonResponse(false, 401, { errors: [{ code: 10000, message: 'Authentication error' }] })
    );

    await expect(generateInlineImage('prompt', MULTIPART_CONFIG)).rejects.toThrow(/401/);
  }, 10000);

  it('HTTP 429は最大2回までリトライしてから失敗する', async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValue(mockJsonResponse(false, 429, { errors: [{ message: 'rate limited' }] }));

    await expect(generateInlineImage('prompt', MULTIPART_CONFIG)).rejects.toThrow(/429/);
    expect(mockFetch).toHaveBeenCalledTimes(3); // 初回 + リトライ2回
  }, 10000);

  it('HTTP 500でもエラーメッセージにステータスを含める', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(mockJsonResponse(false, 500, {}));

    await expect(generateInlineImage('prompt', MULTIPART_CONFIG)).rejects.toThrow(/500/);
  }, 10000);

  it('6003のようなエラーコードもエラーメッセージへ含める', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockJsonResponse(false, 400, { errors: [{ code: 6003, message: 'Request body is not valid json' }] })
    );

    await expect(generateInlineImage('prompt', KLEIN_CONFIG)).rejects.toThrow(/6003/);
  }, 10000);

  it('画像データが欠落している場合はエラーを投げる', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(mockJsonResponse(true, 200, { result: {} }));

    await expect(generateInlineImage('prompt', MULTIPART_CONFIG)).rejects.toThrow(/no image data/);
  }, 10000);
});
