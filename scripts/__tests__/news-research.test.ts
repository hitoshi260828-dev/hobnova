import { beforeEach, describe, expect, it, vi } from 'vitest';

const responsesCreateMock = vi.fn();

vi.mock('openai', () => ({
  default: class MockOpenAI {
    responses = { create: responsesCreateMock };
  },
}));

const { researchNews } = await import('../lib/news/research.mjs');

function mockResponse(obj: unknown) {
  responsesCreateMock.mockResolvedValue({ output_text: JSON.stringify(obj) });
}

const BASE_RESULT = {
  title: 'テストタイトル',
  description: 'テスト説明文',
  topics: ['ai'],
  items: [
    { heading: '見出し1', body: '本文1', sourceName: 'Source A', sourceUrl: 'https://good.example/a' },
    { heading: '見出し2', body: '本文2', sourceName: 'Source B', sourceUrl: 'https://bad.example/b' },
  ],
};

// 実例（2026-10-17、PR #62の品質レビューで発見）: web_searchの結果が本物のドメイン
// （www.soumu.go.jp）のパスをハルシネートされたIPリテラルホスト名に紛れ込ませたURLを
// 返し、構文チェックは通過するがクリックするとTLS証明書のホスト名不一致になる、という
// 事故が実際に発生した。researchNewsはこれをsourceUrl単位のHTTP到達性チェックで検出・
// 除外する（scripts/lib/news/research.mjsのverifySourceUrlResolves）。
describe('researchNews: sourceUrl解決チェック', () => {
  beforeEach(() => responsesCreateMock.mockReset());

  it('resolvableなitemのみ残し、resolveできないitemはrejectedSourcesへ分離する', async () => {
    mockResponse(BASE_RESULT);
    const fetchImpl = vi.fn(async (url: string) =>
      url === 'https://good.example/a' ? { ok: true, status: 200 } : { ok: false, status: 404 }
    );

    const result = await researchNews(
      { edition: 'morning', date: '2026-10-20', excludeUrls: [] },
      { apiKey: 'k', model: 'm' },
      { fetchImpl: fetchImpl as unknown as typeof fetch }
    );

    expect(result.items).toHaveLength(1);
    expect(result.items[0].sourceUrl).toBe('https://good.example/a');
    expect(result.rejectedSources).toHaveLength(1);
    expect(result.rejectedSources[0].sourceUrl).toBe('https://bad.example/b');
  });

  it('全itemが解決不可ならエラーを投げる（公開対象ゼロ）', async () => {
    mockResponse(BASE_RESULT);
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 404 }));

    await expect(
      researchNews(
        { edition: 'morning', date: '2026-10-20', excludeUrls: [] },
        { apiKey: 'k', model: 'm' },
        { fetchImpl: fetchImpl as unknown as typeof fetch }
      )
    ).rejects.toThrow(/no item had a sourceUrl/);
  });

  it('HEADが405（未対応）を返すサーバーはGETで再確認する', async () => {
    mockResponse({ ...BASE_RESULT, items: [BASE_RESULT.items[0]] });
    const fetchImpl = vi.fn(async (_url: string, opts: { method: string }) =>
      opts.method === 'HEAD' ? { ok: false, status: 405 } : { ok: true, status: 200 }
    );

    const result = await researchNews(
      { edition: 'morning', date: '2026-10-20', excludeUrls: [] },
      { apiKey: 'k', model: 'm' },
      { fetchImpl: fetchImpl as unknown as typeof fetch }
    );
    expect(result.items).toHaveLength(1);
  });

  it('fetchが例外を投げる場合（TLS証明書のホスト名不一致・ネットワークエラー等）はresolve不可として扱う', async () => {
    mockResponse(BASE_RESULT);
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === 'https://good.example/a') return { ok: true, status: 200 };
      throw new Error('certificate hostname mismatch');
    });

    const result = await researchNews(
      { edition: 'morning', date: '2026-10-20', excludeUrls: [] },
      { apiKey: 'k', model: 'm' },
      { fetchImpl: fetchImpl as unknown as typeof fetch }
    );
    expect(result.items).toHaveLength(1);
    expect(result.rejectedSources[0].sourceUrl).toBe('https://bad.example/b');
  });
});
