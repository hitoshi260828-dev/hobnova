import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const execFileMock = vi.fn();

vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => {
    const cb = args[args.length - 1] as (err: Error | null, result: { stdout: string; stderr: string }) => void;
    execFileMock(...args.slice(0, -1))
      .then((result: { stdout: string }) => cb(null, { stdout: result.stdout, stderr: '' }))
      .catch((err: Error) => cb(err, { stdout: '', stderr: '' }));
  },
}));

const {
  waitForCloudflarePreview,
  getPrUrl,
  listOpenContentPRs,
  getPrMergeSafety,
  squashMergePR,
  waitForProductionDeploy,
} = await import('../lib/github-pr.mjs');

function mockPrView(data: Record<string, unknown>) {
  execFileMock.mockResolvedValue({ stdout: JSON.stringify(data) });
}

describe('getPrUrl', () => {
  beforeEach(() => execFileMock.mockReset());

  it('gh pr viewのurlフィールドを返す', async () => {
    mockPrView({ url: 'https://github.com/x/y/pull/57' });
    const url = await getPrUrl(57);
    expect(url).toBe('https://github.com/x/y/pull/57');
  });
});

describe('waitForCloudflarePreview', () => {
  beforeEach(() => execFileMock.mockReset());
  afterEach(() => vi.useRealTimers());

  it('headRefOidが一致しなければstale:trueを返す', async () => {
    mockPrView({ url: 'https://github.com/x/y/pull/1', headRefOid: 'old-sha', comments: [] });
    const result = await waitForCloudflarePreview(1, 'new-sha', { timeoutMs: 100, pollIntervalMs: 10 });
    expect(result).toEqual({ stale: true });
  });

  it('Cloudflare Pagesの成功コメントが見つかればpreviewUrl/prUrlを返す', async () => {
    mockPrView({
      url: 'https://github.com/x/y/pull/1',
      headRefOid: 'abcdef1234567890',
      comments: [
        {
          author: { login: 'cloudflare-workers-and-pages[bot]' },
          body:
            'Deploy successful!\n' +
            '<strong>Latest commit:</strong></td><td><code>abcdef1</code></td>\n' +
            '<strong>Preview URL:</strong></td><td><a href="https://abc.pages.dev">https://abc.pages.dev</a></td>',
        },
      ],
    });
    const result = await waitForCloudflarePreview(1, 'abcdef1234567890', { timeoutMs: 100, pollIntervalMs: 10 });
    expect(result).toEqual({ previewUrl: 'https://abc.pages.dev', prUrl: 'https://github.com/x/y/pull/1' });
  });

  it('タイムアウトしても例外を投げず、timedOut:trueとprUrlを返す（通知を失わないための要件）', async () => {
    mockPrView({ url: 'https://github.com/x/y/pull/57', headRefOid: 'abcdef1234567890', comments: [] });
    const result = await waitForCloudflarePreview(1, 'abcdef1234567890', { timeoutMs: 30, pollIntervalMs: 10 });
    expect(result).toEqual({ timedOut: true, prUrl: 'https://github.com/x/y/pull/57' });
  });
});

describe('listOpenContentPRs', () => {
  beforeEach(() => execFileMock.mockReset());

  it('draftを除外し、src/content/を変更しているPRだけを作成日の古い順で返す', async () => {
    execFileMock.mockResolvedValue({
      stdout: JSON.stringify([
        {
          number: 58,
          title: 'draft article',
          createdAt: '2026-10-14T00:00:00Z',
          isDraft: true,
          files: [{ path: 'src/content/articles/x.md' }],
        },
        {
          number: 19,
          title: 'unrelated feature',
          createdAt: '2026-09-29T00:00:00Z',
          isDraft: false,
          files: [{ path: 'package.json' }],
        },
        {
          number: 57,
          title: 'ready article',
          createdAt: '2026-10-09T00:00:00Z',
          isDraft: false,
          files: [{ path: 'src/content/articles/wifi-router.md' }],
        },
        {
          number: 55,
          title: 'older ready article',
          createdAt: '2026-10-07T00:00:00Z',
          isDraft: false,
          files: [{ path: 'src/content/articles/aladdin.md' }],
        },
      ]),
    });
    const result = await listOpenContentPRs();
    expect(result.map((pr: { number: number }) => pr.number)).toEqual([55, 57]);
  });
});

describe('getPrMergeSafety', () => {
  beforeEach(() => execFileMock.mockReset());

  it('mergeable・CI green・Cloudflare greenが揃えばすべてtrueを返す', async () => {
    mockPrView({
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'CLEAN',
      statusCheckRollup: [
        { name: 'astro check & build', conclusion: 'SUCCESS' },
        { name: 'Cloudflare Pages', conclusion: 'SUCCESS' },
      ],
    });
    const safety = await getPrMergeSafety(57);
    expect(safety).toEqual({ mergeable: true, ciSuccess: true, cloudflareSuccess: true });
  });

  it('CIが失敗していればciSuccess:falseを返す', async () => {
    mockPrView({
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'CLEAN',
      statusCheckRollup: [{ name: 'astro check & build', conclusion: 'FAILURE' }],
    });
    const safety = await getPrMergeSafety(57);
    expect(safety.ciSuccess).toBe(false);
  });

  it('mergeStateStatusがCLEANでなければmergeable:falseを返す', async () => {
    mockPrView({
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'BEHIND',
      statusCheckRollup: [{ name: 'astro check & build', conclusion: 'SUCCESS' }],
    });
    const safety = await getPrMergeSafety(56);
    expect(safety.mergeable).toBe(false);
  });

  it('Cloudflare Pagesチェックが存在しない場合はcloudflareSuccessをtrue扱いにする（必須チェックではないため）', async () => {
    mockPrView({
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'CLEAN',
      statusCheckRollup: [{ name: 'astro check & build', conclusion: 'SUCCESS' }],
    });
    const safety = await getPrMergeSafety(57);
    expect(safety.cloudflareSuccess).toBe(true);
  });
});

describe('squashMergePR', () => {
  beforeEach(() => execFileMock.mockReset());

  it('gh pr mergeを--squash --delete-branch=falseで呼び、commit SHAを返す', async () => {
    execFileMock.mockResolvedValueOnce({ stdout: '' }); // gh pr merge自体は標準出力なし
    execFileMock.mockResolvedValueOnce({
      stdout: JSON.stringify({ mergeCommit: { oid: 'abc123' }, url: 'https://github.com/x/y/pull/57' }),
    });
    const result = await squashMergePR(57);
    expect(result).toEqual({ commitSha: 'abc123', prUrl: 'https://github.com/x/y/pull/57' });
    expect(execFileMock.mock.calls[0][1]).toEqual(['pr', 'merge', '57', '--squash', '--delete-branch=false']);
  });
});

describe('waitForProductionDeploy', () => {
  beforeEach(() => execFileMock.mockReset());

  it('Cloudflare Pages check-runがcompleted/successになれば{completed:true, success:true}を返す', async () => {
    execFileMock.mockResolvedValue({
      stdout: JSON.stringify({ check_runs: [{ name: 'Cloudflare Pages', status: 'completed', conclusion: 'success' }] }),
    });
    const result = await waitForProductionDeploy('abc123', { timeoutMs: 100, pollIntervalMs: 10 });
    expect(result).toEqual({ completed: true, success: true });
  });

  it('completed/failureなら{completed:true, success:false}を返す', async () => {
    execFileMock.mockResolvedValue({
      stdout: JSON.stringify({ check_runs: [{ name: 'Cloudflare Pages', status: 'completed', conclusion: 'failure' }] }),
    });
    const result = await waitForProductionDeploy('abc123', { timeoutMs: 100, pollIntervalMs: 10 });
    expect(result).toEqual({ completed: true, success: false });
  });

  it('タイムアウトまでcompletedにならなければ{completed:false, success:false}を返す', async () => {
    execFileMock.mockResolvedValue({ stdout: JSON.stringify({ check_runs: [] }) });
    const result = await waitForProductionDeploy('abc123', { timeoutMs: 30, pollIntervalMs: 10 });
    expect(result).toEqual({ completed: false, success: false });
  });
});
