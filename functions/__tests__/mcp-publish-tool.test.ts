import { describe, expect, it, vi } from 'vitest';

const validateAccessTokenMock = vi.fn();
const publishCoverMock = vi.fn();

vi.mock('../_lib/oauth', async () => {
  const actual = await vi.importActual<typeof import('../_lib/oauth')>('../_lib/oauth');
  return { ...actual, validateAccessToken: validateAccessTokenMock };
});

vi.mock('../_lib/cover-publish', async () => {
  const actual = await vi.importActual<typeof import('../_lib/cover-publish')>('../_lib/cover-publish');
  return { ...actual, publishCover: publishCoverMock };
});

const { onRequestPost } = await import('../api/mcp');

const ENV = { CONTACTS_DB: {} as unknown, GITHUB_TOKEN: 'tok' };

function rpcRequest(body: Record<string, unknown>, token = 'valid-token'): Request {
  return new Request('https://hobnova.jp/api/mcp', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/mcp — publish_generated_image wiring', () => {
  it('tools/list に publish_generated_image が含まれる', async () => {
    validateAccessTokenMock.mockResolvedValue({ id: 1, client_id: 'c', resource: null, scope: null });
    const res = await onRequestPost({
      request: rpcRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      env: ENV,
    } as never);
    const body = (await res.json()) as any;
    const names = body.result.tools.map((t: { name: string }) => t.name);
    expect(names).toContain('publish_generated_image');
  });

  it('tools/call publish_generated_image は cover-publish.publishCover を呼び、結果をcontentへ包んで返す', async () => {
    validateAccessTokenMock.mockResolvedValue({ id: 1, client_id: 'c', resource: null, scope: null });
    publishCoverMock.mockResolvedValue({
      status: 'success',
      article_path: 'src/content/articles/laptop-buying-guide.md',
      image_path: 'src/content/articles/laptop-buying-guide-hero.png',
      branch: 'feat/chatgpt-cover-laptop-buying-guide-123',
      commit_sha: 'sha1',
      pr_number: 42,
      pr_url: 'https://github.com/x/y/pull/42',
      mergeable: null,
    });

    const res = await onRequestPost({
      request: rpcRequest({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'publish_generated_image',
          arguments: {
            article_path: 'src/content/articles/laptop-buying-guide.md',
            image: { data: 'ZmFrZQ==', mime_type: 'image/png' },
          },
        },
      }),
      env: ENV,
    } as never);

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(publishCoverMock).toHaveBeenCalledWith(
      ENV,
      expect.objectContaining({ article_path: 'src/content/articles/laptop-buying-guide.md' })
    );
    const content = JSON.parse(body.result.content[0].text);
    expect(content.status).toBe('success');
    expect(content.pr_number).toBe(42);
    expect(body.result.isError).toBe(false);
  });

  it('publishCoverがerror結果を返した場合、isError: trueで返す', async () => {
    validateAccessTokenMock.mockResolvedValue({ id: 1, client_id: 'c', resource: null, scope: null });
    publishCoverMock.mockResolvedValue({ status: 'error', code: 'article_not_found', message: 'not found' });

    const res = await onRequestPost({
      request: rpcRequest({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'publish_generated_image',
          arguments: { article_path: 'src/content/articles/missing.md', image: { data: 'x' } },
        },
      }),
      env: ENV,
    } as never);

    const body = (await res.json()) as any;
    expect(body.result.isError).toBe(true);
  });

  it('Bearerトークンが無ければ401を返し、publishCoverを呼ばない', async () => {
    const res = await onRequestPost({
      request: new Request('https://hobnova.jp/api/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      }),
      env: ENV,
    } as never);
    expect(res.status).toBe(401);
    expect(publishCoverMock).not.toHaveBeenCalled();
  });

  it('無効なトークンなら401を返す', async () => {
    validateAccessTokenMock.mockResolvedValue(null);
    const res = await onRequestPost({ request: rpcRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list' }), env: ENV } as never);
    expect(res.status).toBe(401);
  });
});
