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

// --- GitHub App private key PEM形式（PKCS#8 / PKCS#1）のテスト用ヘルパー ---

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function pemBlock(label: string, bytes: Uint8Array): string {
  const base64 = toBase64(bytes);
  const lines = base64.match(/.{1,64}/g) ?? [base64];
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----`;
}

async function generateTestKeyPair(): Promise<CryptoKeyPair> {
  return (await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify']
  )) as CryptoKeyPair;
}

function parseDerLength(bytes: Uint8Array, offset: number): { length: number; next: number } {
  const first = bytes[offset];
  if (first < 0x80) return { length: first, next: offset + 1 };
  const numBytes = first & 0x7f;
  let length = 0;
  for (let i = 0; i < numBytes; i++) length = (length << 8) | bytes[offset + 1 + i];
  return { length, next: offset + 1 + numBytes };
}

// テスト用: PKCS#8 DER（SEQUENCE{version, AlgorithmIdentifier, OCTET STRING{PKCS#1 DER}}）から
// 内側のPKCS#1 DERを取り出す。本番コード（pkcs1DerToPkcs8Der）のちょうど逆方向の変換。
function extractPkcs1FromPkcs8(pkcs8: Uint8Array): Uint8Array {
  let offset = 1; // 先頭SEQUENCEタグをスキップ
  const seq = parseDerLength(pkcs8, offset);
  offset = seq.next;
  offset += 1; // version INTEGERタグ
  const ver = parseDerLength(pkcs8, offset);
  offset = ver.next + ver.length;
  offset += 1; // AlgorithmIdentifier SEQUENCEタグ
  const alg = parseDerLength(pkcs8, offset);
  offset = alg.next + alg.length;
  offset += 1; // OCTET STRINGタグ
  const oct = parseDerLength(pkcs8, offset);
  return pkcs8.slice(oct.next, oct.next + oct.length);
}

async function toPkcs8Pem(keyPair: CryptoKeyPair): Promise<string> {
  const der = (await crypto.subtle.exportKey('pkcs8', keyPair.privateKey)) as ArrayBuffer;
  return pemBlock('PRIVATE KEY', new Uint8Array(der));
}

async function toPkcs1Pem(keyPair: CryptoKeyPair): Promise<string> {
  const pkcs8Der = (await crypto.subtle.exportKey('pkcs8', keyPair.privateKey)) as ArrayBuffer;
  const pkcs1Der = extractPkcs1FromPkcs8(new Uint8Array(pkcs8Der));
  return pemBlock('RSA PRIVATE KEY', pkcs1Der);
}

async function verifyJwtSignature(
  jwt: string,
  publicKey: CryptoKey
): Promise<{ valid: boolean; payload: Record<string, unknown> }> {
  const parts = jwt.split('.');
  expect(parts).toHaveLength(3);
  const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
  const signingInput = `${parts[0]}.${parts[1]}`;
  const signatureBytes = Uint8Array.from(atob(parts[2].replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    publicKey,
    signatureBytes,
    new TextEncoder().encode(signingInput)
  );
  return { valid, payload };
}

function mockInstallationTokenEndpoint() {
  const fetchMock = vi.fn().mockResolvedValueOnce(
    new Response(JSON.stringify({ token: 'installation-tok', expires_at: '2026-01-01T00:00:00Z' }), {
      status: 201,
      headers: { 'content-type': 'application/json' },
    })
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

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

  it('PKCS#8形式（BEGIN PRIVATE KEY）のPEMでJWT署名・installation token取得に成功する', async () => {
    const keyPair = await generateTestKeyPair();
    const pem = await toPkcs8Pem(keyPair);
    const fetchMock = mockInstallationTokenEndpoint();

    const token = await resolveGitHubToken({
      GITHUB_APP_ID: '12345',
      GITHUB_APP_PRIVATE_KEY: pem,
      GITHUB_APP_INSTALLATION_ID: '67890',
    });

    expect(token).toBe('installation-tok');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.github.com/app/installations/67890/access_tokens');
    const jwt = (init.headers as Record<string, string>).authorization.replace('Bearer ', '');
    const { valid, payload } = await verifyJwtSignature(jwt, keyPair.publicKey);
    expect(valid).toBe(true);
    expect(payload.iss).toBe('12345');
    expect(typeof payload.exp).toBe('number');
  });

  it('PKCS#1形式（BEGIN RSA PRIVATE KEY）のPEMもPKCS#8へ変換してJWT署名に成功する', async () => {
    const keyPair = await generateTestKeyPair();
    const pem = await toPkcs1Pem(keyPair);
    expect(pem).toContain('-----BEGIN RSA PRIVATE KEY-----');

    const fetchMock = mockInstallationTokenEndpoint();

    const token = await resolveGitHubToken({
      GITHUB_APP_ID: '12345',
      GITHUB_APP_PRIVATE_KEY: pem,
      GITHUB_APP_INSTALLATION_ID: '67890',
    });

    expect(token).toBe('installation-tok');
    const [, init] = fetchMock.mock.calls[0];
    const jwt = (init.headers as Record<string, string>).authorization.replace('Bearer ', '');
    // PKCS#1→PKCS#8変換が「ヘッダーだけ削除」ではなく正しいASN.1再構成であることの証明として、
    // 変換後の鍵で実際に署名検証が通ることを確認する。
    const { valid, payload } = await verifyJwtSignature(jwt, keyPair.publicKey);
    expect(valid).toBe(true);
    expect(payload.iss).toBe('12345');
  });

  it('BEGIN/ENDマーカーが無いmalformedなPEMはエラーを投げる', async () => {
    await expect(
      resolveGitHubToken({
        GITHUB_APP_ID: '12345',
        GITHUB_APP_PRIVATE_KEY: 'not a pem at all',
        GITHUB_APP_INSTALLATION_ID: '67890',
      })
    ).rejects.toThrow(/malformed/);
  });

  it('base64部分が壊れているPEMはエラーを投げる', async () => {
    await expect(
      resolveGitHubToken({
        GITHUB_APP_ID: '12345',
        GITHUB_APP_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\n!!!not-base64!!!\n-----END PRIVATE KEY-----',
        GITHUB_APP_INSTALLATION_ID: '67890',
      })
    ).rejects.toThrow(/malformed/);
  });

  it('未対応のPEM形式（例: EC PRIVATE KEY）はエラーを投げる', async () => {
    await expect(
      resolveGitHubToken({
        GITHUB_APP_ID: '12345',
        GITHUB_APP_PRIVATE_KEY: '-----BEGIN EC PRIVATE KEY-----\nAAAA\n-----END EC PRIVATE KEY-----',
        GITHUB_APP_INSTALLATION_ID: '67890',
      })
    ).rejects.toThrow(/unsupported/);
  });

  it('PEM関連のエラーメッセージに鍵のbase64本体を含めない（秘密情報非露出）', async () => {
    const secretLookingBody = 'MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7VJTUt9Us8cKj';
    try {
      await resolveGitHubToken({
        GITHUB_APP_ID: '12345',
        GITHUB_APP_PRIVATE_KEY: `-----BEGIN EC PRIVATE KEY-----\n${secretLookingBody}\n-----END EC PRIVATE KEY-----`,
        GITHUB_APP_INSTALLATION_ID: '67890',
      });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as Error).message).not.toContain(secretLookingBody);
    }
  });

  it('GitHub App認証情報が一部しか無ければPATへフォールバックする', async () => {
    const token = await resolveGitHubToken({ GITHUB_TOKEN: 'fallback-pat', GITHUB_APP_ID: '123' });
    expect(token).toBe('fallback-pat');
  });
});
