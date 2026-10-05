import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bytesToBase64 } from '../_lib/image-validate';

const getBranchHeadShaMock = vi.fn();
const getCommitMock = vi.fn();
const getFileContentsMock = vi.fn();
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
    createBlob: createBlobMock,
    createRef: createRefMock,
    createTree: createTreeMock,
    createCommitObject: createCommitObjectMock,
    updateRef: updateRefMock,
    createPullRequest: createPullRequestMock,
    resolveGitHubToken: resolveGitHubTokenMock,
  };
});

const { publishCover } = await import('../_lib/cover-publish');

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const PNG_BASE64 = bytesToBase64(PNG_BYTES);

const NO_IMAGE_MD = `---\ntitle: "用途別に選ぶノートPCの選び方2026"\ndescription: "desc"\npublishDate: 2026-08-10\ncategory: "gadget"\ndraft: false\n---\n\n本文\n`;
const WITH_SVG_COVER_MD = `---\ntitle: "既存cover付き"\ndescription: "desc"\npublishDate: 2026-08-10\nimage: "./laptop-buying-guide-hero.svg"\ndraft: false\n---\n\n本文\n`;

function encodeContent(md: string): string {
  return btoa(unescape(encodeURIComponent(md)));
}

const ENV = { GITHUB_TOKEN: 'test-token' };

describe('publishCover', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveGitHubTokenMock.mockResolvedValue('resolved-token');
    getBranchHeadShaMock.mockResolvedValue('main-sha');
    getCommitMock.mockResolvedValue({ sha: 'main-sha', tree: { sha: 'main-tree-sha' } });
    createBlobMock.mockImplementation(async (_t, _r, content: string) =>
      content.length > 100 ? 'markdown-blob-sha' : 'image-blob-sha'
    );
    createRefMock.mockResolvedValue(undefined);
    createTreeMock.mockResolvedValue('new-tree-sha');
    createCommitObjectMock.mockResolvedValue('new-commit-sha');
    updateRefMock.mockResolvedValue(undefined);
    createPullRequestMock.mockResolvedValue({ number: 42, html_url: 'https://github.com/x/y/pull/42', mergeable: null });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('article_pathが不正ならGitHub呼び出し無しでerrorを返す', async () => {
    const result = await publishCover(ENV, {
      article_path: 'src/pages/index.astro',
      image: { data: PNG_BASE64, mime_type: 'image/png' },
    });
    expect(result.status).toBe('error');
    if (result.status === 'error') expect(result.code).toBe('invalid_article_path');
    expect(resolveGitHubTokenMock).not.toHaveBeenCalled();
  });

  it('path traversalはGitHub呼び出し無しでerrorを返す', async () => {
    const result = await publishCover(ENV, {
      article_path: 'src/content/articles/../../secrets.md',
      image: { data: PNG_BASE64, mime_type: 'image/png' },
    });
    expect(result.status).toBe('error');
    expect(getFileContentsMock).not.toHaveBeenCalled();
  });

  it('画像が不正（MIME不一致）ならerrorを返す', async () => {
    const result = await publishCover(ENV, {
      article_path: 'src/content/articles/laptop-buying-guide.md',
      image: { data: PNG_BASE64, mime_type: 'image/svg+xml' },
    });
    expect(result.status).toBe('error');
    if (result.status === 'error') expect(result.code).toBe('invalid_image');
  });

  it('記事が見つからなければarticle_not_foundを返す', async () => {
    getFileContentsMock.mockResolvedValue(null);
    const result = await publishCover(ENV, {
      article_path: 'src/content/articles/does-not-exist.md',
      image: { data: PNG_BASE64, mime_type: 'image/png' },
    });
    expect(result.status).toBe('error');
    if (result.status === 'error') expect(result.code).toBe('article_not_found');
  });

  it('既存coverがありreplace未指定ならcover_existsを返し、GitHubへ書き込まない', async () => {
    getFileContentsMock.mockResolvedValue({ sha: 'filesha', content: encodeContent(WITH_SVG_COVER_MD), encoding: 'base64' });
    const result = await publishCover(ENV, {
      article_path: 'src/content/articles/laptop-buying-guide.md',
      image: { data: PNG_BASE64, mime_type: 'image/png' },
    });
    expect(result.status).toBe('cover_exists');
    if (result.status === 'cover_exists') expect(result.current_image).toBe('./laptop-buying-guide-hero.svg');
    expect(createRefMock).not.toHaveBeenCalled();
    expect(createPullRequestMock).not.toHaveBeenCalled();
  });

  it('dry_run=trueなら計画のみ返し、GitHubへ一切書き込まない', async () => {
    getFileContentsMock.mockResolvedValue({ sha: 'filesha', content: encodeContent(NO_IMAGE_MD), encoding: 'base64' });
    const result = await publishCover(ENV, {
      article_path: 'src/content/articles/laptop-buying-guide.md',
      image: { data: PNG_BASE64, mime_type: 'image/png' },
      dry_run: true,
    });
    expect(result.status).toBe('dry_run');
    if (result.status === 'dry_run') {
      expect(result.image_path).toBe('src/content/articles/laptop-buying-guide-hero.png');
      expect(result.existing_image).toBeNull();
    }
    expect(createRefMock).not.toHaveBeenCalled();
    expect(createBlobMock).not.toHaveBeenCalled();
    expect(createPullRequestMock).not.toHaveBeenCalled();
  });

  it('新規cover: branch作成→blob→tree→commit→ref更新→PR作成まで実行し、成功結果を返す', async () => {
    getFileContentsMock.mockResolvedValue({ sha: 'filesha', content: encodeContent(NO_IMAGE_MD), encoding: 'base64' });
    const result = await publishCover(ENV, {
      article_path: 'src/content/articles/laptop-buying-guide.md',
      image: { data: PNG_BASE64, mime_type: 'image/png' },
      alt: 'テスト画像',
    });

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(result.image_path).toBe('src/content/articles/laptop-buying-guide-hero.png');
    expect(result.pr_number).toBe(42);
    expect(result.pr_url).toBe('https://github.com/x/y/pull/42');
    expect(result.commit_sha).toBe('new-commit-sha');
    expect(result.branch).toMatch(/^feat\/chatgpt-cover-laptop-buying-guide-\d+$/);

    expect(createRefMock).toHaveBeenCalledWith('resolved-token', expect.anything(), result.branch, 'main-sha');
    expect(createTreeMock).toHaveBeenCalledWith('resolved-token', expect.anything(), 'main-tree-sha', expect.any(Array));
    const treeEntries = createTreeMock.mock.calls[0][3];
    expect(treeEntries).toHaveLength(2); // 画像追加 + frontmatter更新のみ（旧cover無し）
    expect(treeEntries.some((e: { path: string }) => e.path === 'src/content/articles/laptop-buying-guide-hero.png')).toBe(
      true
    );
    expect(treeEntries.some((e: { path: string }) => e.path === 'src/content/articles/laptop-buying-guide.md')).toBe(
      true
    );

    expect(createPullRequestMock).toHaveBeenCalledWith(
      'resolved-token',
      expect.anything(),
      expect.objectContaining({ base: 'main', head: result.branch })
    );
  });

  it('replace=trueで拡張子が変わる場合、旧ファイルをtree内でsha:null指定して削除する', async () => {
    getFileContentsMock.mockResolvedValue({ sha: 'filesha', content: encodeContent(WITH_SVG_COVER_MD), encoding: 'base64' });
    const result = await publishCover(ENV, {
      article_path: 'src/content/articles/laptop-buying-guide.md',
      image: { data: PNG_BASE64, mime_type: 'image/png' },
      replace: true,
    });

    expect(result.status).toBe('success');
    const treeEntries = createTreeMock.mock.calls[0][3];
    expect(treeEntries).toHaveLength(3); // 新画像 + frontmatter + 旧svg削除
    const deletion = treeEntries.find((e: { path: string }) => e.path === 'src/content/articles/laptop-buying-guide-hero.svg');
    expect(deletion).toBeDefined();
    expect(deletion.sha).toBeNull();
  });

  it('blob作成が失敗したらerrorを返し、以降の処理（ref更新・PR作成）は実行しない', async () => {
    getFileContentsMock.mockResolvedValue({ sha: 'filesha', content: encodeContent(NO_IMAGE_MD), encoding: 'base64' });
    createBlobMock.mockRejectedValueOnce(new Error('GitHub API /blobs failed: 422 Validation Failed'));

    const result = await publishCover(ENV, {
      article_path: 'src/content/articles/laptop-buying-guide.md',
      image: { data: PNG_BASE64, mime_type: 'image/png' },
    });

    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.code).toBe('github_api_error');
      expect(result.message).toContain('422');
    }
    expect(createPullRequestMock).not.toHaveBeenCalled();
  });

  it('branch作成が失敗したらerrorを返す', async () => {
    getFileContentsMock.mockResolvedValue({ sha: 'filesha', content: encodeContent(NO_IMAGE_MD), encoding: 'base64' });
    createRefMock.mockRejectedValueOnce(new Error('GitHub API /git/refs failed: 422 Reference already exists'));

    const result = await publishCover(ENV, {
      article_path: 'src/content/articles/laptop-buying-guide.md',
      image: { data: PNG_BASE64, mime_type: 'image/png' },
    });

    expect(result.status).toBe('error');
    expect(createBlobMock).not.toHaveBeenCalled();
  });

  it('frontmatterが無い記事はno_frontmatterエラーを返す', async () => {
    getFileContentsMock.mockResolvedValue({ sha: 'filesha', content: encodeContent('# frontmatterなし\n'), encoding: 'base64' });
    const result = await publishCover(ENV, {
      article_path: 'src/content/articles/laptop-buying-guide.md',
      image: { data: PNG_BASE64, mime_type: 'image/png' },
    });
    expect(result.status).toBe('error');
    if (result.status === 'error') expect(result.code).toBe('no_frontmatter');
  });

  it('GitHub認証解決に失敗したらgithub_auth_failedを返す', async () => {
    resolveGitHubTokenMock.mockRejectedValueOnce(new Error('No GitHub credentials configured'));
    const result = await publishCover(ENV, {
      article_path: 'src/content/articles/laptop-buying-guide.md',
      image: { data: PNG_BASE64, mime_type: 'image/png' },
    });
    expect(result.status).toBe('error');
    if (result.status === 'error') expect(result.code).toBe('github_auth_failed');
  });

  it('エラーメッセージにトークン値を含めない（秘密情報非露出）', async () => {
    getFileContentsMock.mockResolvedValue({ sha: 'filesha', content: encodeContent(NO_IMAGE_MD), encoding: 'base64' });
    createBlobMock.mockRejectedValueOnce(new Error('unexpected failure'));

    const result = await publishCover(ENV, {
      article_path: 'src/content/articles/laptop-buying-guide.md',
      image: { data: PNG_BASE64, mime_type: 'image/png' },
    });

    expect(JSON.stringify(result)).not.toContain('test-token');
    expect(JSON.stringify(result)).not.toContain('resolved-token');
  });
});
