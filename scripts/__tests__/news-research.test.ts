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

// 既定ではverifySourceUrlResolvesが実際にDNS解決(dns.lookup)を行うため、.exampleドメイン
// （RFC 2606で意図的に解決不能）を使うテストは全てlookupImplを差し替える必要がある。
// ここでは「どのホスト名も安全なパブリックIPに解決される」ものとして固定する。
function publicLookupImpl() {
  return vi.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
}

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
      { fetchImpl: fetchImpl as unknown as typeof fetch, lookupImpl: publicLookupImpl() as never }
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
        { fetchImpl: fetchImpl as unknown as typeof fetch, lookupImpl: publicLookupImpl() as never }
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
      { fetchImpl: fetchImpl as unknown as typeof fetch, lookupImpl: publicLookupImpl() as never }
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
      { fetchImpl: fetchImpl as unknown as typeof fetch, lookupImpl: publicLookupImpl() as never }
    );
    expect(result.items).toHaveLength(1);
    expect(result.rejectedSources[0].sourceUrl).toBe('https://bad.example/b');
  });
});

// SSRF対策（独立レビューで発見、2026-10-17）: このURLチェックはGitHub Actionsランナー上で
// 実行され、Cloudflare Workersのようなプラットフォーム側fetch制限が無い。OpenAIモデルが
// 生成した信頼できないsourceUrlが、プライベート/予約IPアドレスやhttp://へ直接fetchされない
// ことを確認する。
describe('researchNews: SSRF対策（private IP / scheme制限）', () => {
  beforeEach(() => responsesCreateMock.mockReset());

  it('httpスキームのsourceUrlはfetchせず拒否する', async () => {
    mockResponse({ ...BASE_RESULT, items: [{ ...BASE_RESULT.items[0], sourceUrl: 'http://good.example/a' }] });
    const fetchImpl = vi.fn();
    const lookupImpl = publicLookupImpl();

    await expect(
      researchNews(
        { edition: 'morning', date: '2026-10-20', excludeUrls: [] },
        { apiKey: 'k', model: 'm' },
        { fetchImpl: fetchImpl as unknown as typeof fetch, lookupImpl: lookupImpl as never }
      )
    ).rejects.toThrow(/no item had a sourceUrl/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('DNS解決結果がプライベートIP（RFC1918）ならfetchせず拒否する', async () => {
    mockResponse(BASE_RESULT);
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const lookupImpl = vi.fn(async (hostname: string) =>
      hostname === 'good.example' ? [{ address: '93.184.216.34', family: 4 }] : [{ address: '10.0.0.5', family: 4 }]
    );

    const result = await researchNews(
      { edition: 'morning', date: '2026-10-20', excludeUrls: [] },
      { apiKey: 'k', model: 'm' },
      { fetchImpl: fetchImpl as unknown as typeof fetch, lookupImpl: lookupImpl as never }
    );
    expect(result.items).toHaveLength(1);
    expect(result.items[0].sourceUrl).toBe('https://good.example/a');
    expect(result.rejectedSources[0].sourceUrl).toBe('https://bad.example/b');
    expect(fetchImpl).not.toHaveBeenCalledWith('https://bad.example/b', expect.anything());
  });

  it('DNS解決結果がクラウドmetadataエンドポイント（169.254.169.254）ならfetchせず拒否する', async () => {
    mockResponse({ ...BASE_RESULT, items: [BASE_RESULT.items[0]] });
    const fetchImpl = vi.fn();
    const lookupImpl = vi.fn().mockResolvedValue([{ address: '169.254.169.254', family: 4 }]);

    await expect(
      researchNews(
        { edition: 'morning', date: '2026-10-20', excludeUrls: [] },
        { apiKey: 'k', model: 'm' },
        { fetchImpl: fetchImpl as unknown as typeof fetch, lookupImpl: lookupImpl as never }
      )
    ).rejects.toThrow(/no item had a sourceUrl/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('DNS解決結果がloopback（127.0.0.1）ならfetchせず拒否する', async () => {
    mockResponse({ ...BASE_RESULT, items: [BASE_RESULT.items[0]] });
    const fetchImpl = vi.fn();
    const lookupImpl = vi.fn().mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);

    await expect(
      researchNews(
        { edition: 'morning', date: '2026-10-20', excludeUrls: [] },
        { apiKey: 'k', model: 'm' },
        { fetchImpl: fetchImpl as unknown as typeof fetch, lookupImpl: lookupImpl as never }
      )
    ).rejects.toThrow(/no item had a sourceUrl/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('IPv6のlink-local（fe80::...）もfetchせず拒否する', async () => {
    mockResponse({ ...BASE_RESULT, items: [BASE_RESULT.items[0]] });
    const fetchImpl = vi.fn();
    const lookupImpl = vi.fn().mockResolvedValue([{ address: 'fe80::1', family: 6 }]);

    await expect(
      researchNews(
        { edition: 'morning', date: '2026-10-20', excludeUrls: [] },
        { apiKey: 'k', model: 'm' },
        { fetchImpl: fetchImpl as unknown as typeof fetch, lookupImpl: lookupImpl as never }
      )
    ).rejects.toThrow(/no item had a sourceUrl/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('redirect後の最終URL（res.url）を採用する。元のsourceUrlとredirect先が異なる場合、公開される値は実際に検証した最終URL', async () => {
    mockResponse({ ...BASE_RESULT, items: [BASE_RESULT.items[0]] });
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, url: 'https://good.example/a/redirected-final-page' });
    const lookupImpl = publicLookupImpl();

    const result = await researchNews(
      { edition: 'morning', date: '2026-10-20', excludeUrls: [] },
      { apiKey: 'k', model: 'm' },
      { fetchImpl: fetchImpl as unknown as typeof fetch, lookupImpl: lookupImpl as never }
    );
    expect(result.items[0].sourceUrl).toBe('https://good.example/a/redirected-final-page');
  });

  it('DNS解決自体が失敗したら解決不可として扱う', async () => {
    mockResponse({ ...BASE_RESULT, items: [BASE_RESULT.items[0]] });
    const fetchImpl = vi.fn();
    const lookupImpl = vi.fn().mockRejectedValue(new Error('ENOTFOUND'));

    await expect(
      researchNews(
        { edition: 'morning', date: '2026-10-20', excludeUrls: [] },
        { apiKey: 'k', model: 'm' },
        { fetchImpl: fetchImpl as unknown as typeof fetch, lookupImpl: lookupImpl as never }
      )
    ).rejects.toThrow(/no item had a sourceUrl/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
