import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createBlob,
  createPullRequest,
  createRef,
  createTree,
  getBranchHeadSha,
  getCommit,
  getFileContents,
  GitHubApiError,
  resolveGitHubToken,
  updateRef,
  type GitHubRepoRef,
} from '../_lib/github-client';

const REPO: GitHubRepoRef = { owner: 'hitoshi260828-dev', repo: 'hobnova' };

function mockFetchOnce(status: number, body: unknown) {
  return vi.fn().mockResolvedValueOnce(
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  );
}

describe('github-client REST helpers', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('getBranchHeadSha は ref API のobject.shaを返す', async () => {
    const fetchMock = mockFetchOnce(200, { object: { sha: 'abc123' } });
    vi.stubGlobal('fetch', fetchMock);

    const sha = await getBranchHeadSha('tok', REPO, 'main');
    expect(sha).toBe('abc123');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.github.com/repos/hitoshi260828-dev/hobnova/git/ref/heads/main');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok');
  });

  it('getCommit はcommit shaとtree shaを返す', async () => {
    vi.stubGlobal('fetch', mockFetchOnce(200, { sha: 'c1', tree: { sha: 't1' } }));
    const commit = await getCommit('tok', REPO, 'c1');
    expect(commit).toEqual({ sha: 'c1', tree: { sha: 't1' } });
  });

  it('getFileContents は404でnullを返す（例外にしない）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('not found', { status: 404 })));
    const result = await getFileContents('tok', REPO, 'src/content/articles/missing.md', 'main');
    expect(result).toBeNull();
  });

  it('getFileContents は200でcontent/shaを返す', async () => {
    vi.stubGlobal('fetch', mockFetchOnce(200, { sha: 's1', content: 'YWJj', encoding: 'base64' }));
    const result = await getFileContents('tok', REPO, 'src/content/articles/x.md', 'main');
    expect(result).toEqual({ sha: 's1', content: 'YWJj', encoding: 'base64' });
  });

  it('getFileContents は404以外のエラーでGitHubApiErrorを投げる', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('forbidden', { status: 403 })));
    await expect(getFileContents('tok', REPO, 'x.md', 'main')).rejects.toThrow(GitHubApiError);
  });

  it('createBlob はPOSTしてshaを返す', async () => {
    const fetchMock = mockFetchOnce(201, { sha: 'blobsha' });
    vi.stubGlobal('fetch', fetchMock);

    const sha = await createBlob('tok', REPO, 'YWJj');
    expect(sha).toBe('blobsha');
    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ content: 'YWJj', encoding: 'base64' });
  });

  it('createRef は refs/heads/<branch> へPOSTする', async () => {
    const fetchMock = mockFetchOnce(201, { ref: 'refs/heads/feat/x' });
    vi.stubGlobal('fetch', fetchMock);

    await createRef('tok', REPO, 'feat/x', 'sha1');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.github.com/repos/hitoshi260828-dev/hobnova/git/refs');
    expect(JSON.parse(init.body as string)).toEqual({ ref: 'refs/heads/feat/x', sha: 'sha1' });
  });

  it('createTree はbase_treeとtree entriesを送る（削除entryのsha: nullも許可）', async () => {
    const fetchMock = mockFetchOnce(201, { sha: 'treesha' });
    vi.stubGlobal('fetch', fetchMock);

    const sha = await createTree('tok', REPO, 'basetree', [
      { path: 'a.png', mode: '100644', type: 'blob', sha: 'blobsha' },
      { path: 'old.svg', mode: '100644', type: 'blob', sha: null },
    ]);
    expect(sha).toBe('treesha');
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.base_tree).toBe('basetree');
    expect(body.tree).toHaveLength(2);
    expect(body.tree[1].sha).toBeNull();
  });

  it('updateRef はPATCHでforce: falseを送る', async () => {
    const fetchMock = mockFetchOnce(200, {});
    vi.stubGlobal('fetch', fetchMock);

    await updateRef('tok', REPO, 'feat/x', 'newsha');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.github.com/repos/hitoshi260828-dev/hobnova/git/refs/heads/feat/x');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ sha: 'newsha', force: false });
  });

  it('createPullRequest はnumber/html_url/mergeableを返す', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchOnce(201, { number: 42, html_url: 'https://github.com/x/y/pull/42', mergeable: null })
    );
    const pr = await createPullRequest('tok', REPO, { title: 't', head: 'feat/x', base: 'main', body: 'b' });
    expect(pr).toEqual({ number: 42, html_url: 'https://github.com/x/y/pull/42', mergeable: null });
  });

  it('APIエラー時はGitHub側のmessageを含めてGitHubApiErrorを投げる（秘密情報は含めない）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(
        new Response(JSON.stringify({ message: 'Bad credentials' }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        })
      )
    );
    await expect(getBranchHeadSha('tok', REPO, 'main')).rejects.toThrow(/Bad credentials/);
  });
});

describe('resolveGitHubToken', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('GITHUB_TOKENのみ設定されていればそれをそのまま返す', async () => {
    const token = await resolveGitHubToken({ GITHUB_TOKEN: 'pat-123' });
    expect(token).toBe('pat-123');
  });

  it('認証情報が何も無ければエラーを投げる', async () => {
    await expect(resolveGitHubToken({})).rejects.toThrow(/No GitHub credentials/);
  });

  it('GitHub App認証情報が3つ揃っていれば installation token エンドポイントを呼ぶ', async () => {
    const keyPair = (await crypto.subtle.generateKey(
      { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      true,
      ['sign', 'verify']
    )) as CryptoKeyPair;
    const pkcs8 = (await crypto.subtle.exportKey('pkcs8', keyPair.privateKey)) as ArrayBuffer;
    const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...new Uint8Array(pkcs8)))}\n-----END PRIVATE KEY-----`;

    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ token: 'installation-tok', expires_at: '2026-01-01T00:00:00Z' }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const token = await resolveGitHubToken({
      GITHUB_APP_ID: '12345',
      GITHUB_APP_PRIVATE_KEY: pem,
      GITHUB_APP_INSTALLATION_ID: '67890',
    });

    expect(token).toBe('installation-tok');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.github.com/app/installations/67890/access_tokens');
    const authHeader = (init.headers as Record<string, string>).authorization as string;
    expect(authHeader).toMatch(/^Bearer /);
    const jwt = authHeader.replace('Bearer ', '');
    const parts = jwt.split('.');
    expect(parts).toHaveLength(3);
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    expect(payload.iss).toBe('12345');
    expect(typeof payload.exp).toBe('number');

    // 構造だけでなく、実際に正しい鍵で署名されたJWTであることまで検証する
    // （誤ったhashアルゴリズムや鍵破損があってもテストが気付けるように）。
    const signingInput = `${parts[0]}.${parts[1]}`;
    const signatureBytes = Uint8Array.from(atob(parts[2].replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
    const isValid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      keyPair.publicKey,
      signatureBytes,
      new TextEncoder().encode(signingInput)
    );
    expect(isValid).toBe(true);
  });

  it('GitHub App認証情報が一部しか無ければPATへフォールバックする', async () => {
    const token = await resolveGitHubToken({ GITHUB_TOKEN: 'fallback-pat', GITHUB_APP_ID: '123' });
    expect(token).toBe('fallback-pat');
  });
});
