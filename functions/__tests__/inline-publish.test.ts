import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bytesToBase64 } from '../_lib/image-validate';

const getBranchHeadShaMock = vi.fn();
const getCommitMock = vi.fn();
const getFileContentsMock = vi.fn();
const listDirectoryMock = vi.fn();
const createBlobMock = vi.fn();
const createRefMock = vi.fn();
const createTreeMock = vi.fn();
const createCommitObjectMock = vi.fn();
const updateRefMock = vi.fn();
const createPullRequestMock = vi.fn();
const resolveGitHubTokenMock = vi.fn();

vi.mock('../_lib/github-client', async () => {
  const actual = await vi.importActual<typeof import('../_lib/github-client')>('../_lib/github-client');
  return {
    ...actual,
    getBranchHeadSha: getBranchHeadShaMock,
    getCommit: getCommitMock,
    getFileContents: getFileContentsMock,
    listDirectory: listDirectoryMock,
    createBlob: createBlobMock,
    createRef: createRefMock,
    createTree: createTreeMock,
    createCommitObject: createCommitObjectMock,
    updateRef: updateRefMock,
    createPullRequest: createPullRequestMock,
    resolveGitHubToken: resolveGitHubTokenMock,
  };
});

const { publishInlineImage } = await import('../_lib/inline-publish');

const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
const JPEG_BASE64 = bytesToBase64(JPEG_BYTES);

const SAMPLE_MD = `---\ntitle: "テスト記事"\ndescription: "desc"\npublishDate: 2026-08-10\ncategory: "gadget"\ndraft: false\n---\n\n導入文\n\n## 製品の比較ポイント\n\n比較についての本文です。\n\n## まとめ\n\n- まとめ1\n`;

function encodeContent(md: string): string {
  return btoa(unescape(encodeURIComponent(md)));
}

const ENV = { GITHUB_TOKEN: 'test-token' };

describe('publishInlineImage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveGitHubTokenMock.mockResolvedValue('resolved-token');
    getBranchHeadShaMock.mockResolvedValue('main-sha');
    getCommitMock.mockResolvedValue({ sha: 'main-sha', tree: { sha: 'main-tree-sha' } });
    getFileContentsMock.mockResolvedValue({ sha: 'filesha', content: encodeContent(SAMPLE_MD), encoding: 'base64' });
    listDirectoryMock.mockResolvedValue(null); // ディレクトリ未作成 = 既存inline画像なし
    createBlobMock.mockResolvedValue('blob-sha');
    createRefMock.mockResolvedValue(undefined);
    createTreeMock.mockResolvedValue('new-tree-sha');
    createCommitObjectMock.mockResolvedValue('new-commit-sha');
    updateRefMock.mockResolvedValue(undefined);
    createPullRequestMock.mockResolvedValue({ number: 60, html_url: 'https://github.com/x/y/pull/60', mergeable: null });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('article_pathが不正ならGitHub呼び出し無しでerrorを返す', async () => {
    const result = await publishInlineImage(ENV, {
      article_path: 'src/pages/index.astro',
      image: { data: JPEG_BASE64, mime_type: 'image/jpeg' },
      position: 1,
    });
    expect(result.status).toBe('error');
    expect(resolveGitHubTokenMock).not.toHaveBeenCalled();
  });

  it('after_headingで指定した見出しの直後へ挿入し、PRを作成する', async () => {
    const result = await publishInlineImage(ENV, {
      article_path: 'src/content/articles/laptop-buying-guide.md',
      image: { data: JPEG_BASE64, mime_type: 'image/jpeg' },
      after_heading: '製品の比較ポイント',
    });

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(result.image_path).toBe('public/images/articles/laptop-buying-guide/inline-01.jpg');
    expect(result.reference_path).toBe('/images/articles/laptop-buying-guide/inline-01.jpg');
    expect(result.heading).toBe('製品の比較ポイント');
    expect(result.pr_number).toBe(60);
    expect(result.branch).toMatch(/^feat\/chatgpt-inline-laptop-buying-guide-\d+$/);

    const markdownBlobCall = createBlobMock.mock.calls.find((c) => (c[2] as string).length > 200);
    expect(markdownBlobCall).toBeDefined();
  });

  it('positionで2番目の見出しを指定できる', async () => {
    const result = await publishInlineImage(ENV, {
      article_path: 'src/content/articles/laptop-buying-guide.md',
      image: { data: JPEG_BASE64, mime_type: 'image/jpeg' },
      position: 2,
    });
    expect(result.status).toBe('success');
    if (result.status === 'success') expect(result.heading).toBe('まとめ');
  });

  it('存在しないafter_headingはエラーを返しGitHubへ書き込まない', async () => {
    const result = await publishInlineImage(ENV, {
      article_path: 'src/content/articles/laptop-buying-guide.md',
      image: { data: JPEG_BASE64, mime_type: 'image/jpeg' },
      after_heading: '存在しない見出し',
    });
    expect(result.status).toBe('error');
    if (result.status === 'error') expect(result.code).toBe('invalid_position');
    expect(createRefMock).not.toHaveBeenCalled();
  });

  it('after_headingもpositionも無ければエラーを返す', async () => {
    const result = await publishInlineImage(ENV, {
      article_path: 'src/content/articles/laptop-buying-guide.md',
      image: { data: JPEG_BASE64, mime_type: 'image/jpeg' },
    });
    expect(result.status).toBe('error');
  });

  it('連続採番: 既存inline-01.jpgがあればinline-02を採番する', async () => {
    listDirectoryMock.mockResolvedValue([{ name: 'inline-01.jpg', type: 'file' }]);
    const result = await publishInlineImage(ENV, {
      article_path: 'src/content/articles/laptop-buying-guide.md',
      image: { data: JPEG_BASE64, mime_type: 'image/jpeg' },
      position: 1,
    });
    expect(result.status).toBe('success');
    if (result.status === 'success') expect(result.image_path).toContain('inline-02.jpg');
  });

  it('本文画像が上限（4枚）に達していればエラーを返す', async () => {
    listDirectoryMock.mockResolvedValue([
      { name: 'inline-01.jpg', type: 'file' },
      { name: 'inline-02.jpg', type: 'file' },
      { name: 'inline-03.jpg', type: 'file' },
      { name: 'inline-04.jpg', type: 'file' },
    ]);
    const result = await publishInlineImage(ENV, {
      article_path: 'src/content/articles/laptop-buying-guide.md',
      image: { data: JPEG_BASE64, mime_type: 'image/jpeg' },
      position: 1,
    });
    expect(result.status).toBe('error');
    if (result.status === 'error') expect(result.code).toBe('inline_limit_reached');
    expect(createRefMock).not.toHaveBeenCalled();
  });

  it('同じ参照パスが既に本文にあればalready_insertedを返しGitHubへ書き込まない', async () => {
    const withImage = SAMPLE_MD.replace(
      '比較についての本文です。',
      '![既存](/images/articles/laptop-buying-guide/inline-01.jpg)\n\n比較についての本文です。'
    );
    getFileContentsMock.mockResolvedValue({ sha: 'filesha', content: encodeContent(withImage), encoding: 'base64' });
    const result = await publishInlineImage(ENV, {
      article_path: 'src/content/articles/laptop-buying-guide.md',
      image: { data: JPEG_BASE64, mime_type: 'image/jpeg' },
      after_heading: '製品の比較ポイント',
    });
    expect(result.status).toBe('already_inserted');
    expect(createRefMock).not.toHaveBeenCalled();
  });

  it('dry_run=trueでは計画のみ返しGitHubへ一切書き込まない', async () => {
    const result = await publishInlineImage(ENV, {
      article_path: 'src/content/articles/laptop-buying-guide.md',
      image: { data: JPEG_BASE64, mime_type: 'image/jpeg' },
      after_heading: '製品の比較ポイント',
      dry_run: true,
    });
    expect(result.status).toBe('dry_run');
    expect(createRefMock).not.toHaveBeenCalled();
    expect(createBlobMock).not.toHaveBeenCalled();
    expect(createPullRequestMock).not.toHaveBeenCalled();
  });

  it('alt未指定なら見出しから自動生成する', async () => {
    const result = await publishInlineImage(ENV, {
      article_path: 'src/content/articles/laptop-buying-guide.md',
      image: { data: JPEG_BASE64, mime_type: 'image/jpeg' },
      after_heading: '製品の比較ポイント',
    });
    expect(result.status).toBe('success');
    // altは本文に挿入されているはずなので、生成されたmarkdown blobにheading由来の文字列が含まれるか確認する。
    const markdownBlobCall = createBlobMock.mock.calls.find((c) => (c[2] as string).length > 200);
    const decoded = decodeURIComponent(escape(atob(markdownBlobCall![2] as string)));
    expect(decoded).toContain('製品の比較ポイント');
  });

  it('記事が見つからなければarticle_not_foundを返す', async () => {
    getFileContentsMock.mockResolvedValue(null);
    const result = await publishInlineImage(ENV, {
      article_path: 'src/content/articles/does-not-exist.md',
      image: { data: JPEG_BASE64, mime_type: 'image/jpeg' },
      position: 1,
    });
    expect(result.status).toBe('error');
    if (result.status === 'error') expect(result.code).toBe('article_not_found');
  });

  it('branch作成が失敗したらerrorを返し孤立branchを削除しようとする', async () => {
    createRefMock.mockRejectedValueOnce(new Error('GitHub API /git/refs failed: 422'));
    const result = await publishInlineImage(ENV, {
      article_path: 'src/content/articles/laptop-buying-guide.md',
      image: { data: JPEG_BASE64, mime_type: 'image/jpeg' },
      after_heading: '製品の比較ポイント',
    });
    expect(result.status).toBe('error');
    expect(createBlobMock).not.toHaveBeenCalled();
  });

  it('エラーメッセージにトークン値を含めない', async () => {
    createBlobMock.mockRejectedValueOnce(new Error('unexpected failure'));
    const result = await publishInlineImage(ENV, {
      article_path: 'src/content/articles/laptop-buying-guide.md',
      image: { data: JPEG_BASE64, mime_type: 'image/jpeg' },
      after_heading: '製品の比較ポイント',
    });
    expect(JSON.stringify(result)).not.toContain('test-token');
    expect(JSON.stringify(result)).not.toContain('resolved-token');
  });
});
