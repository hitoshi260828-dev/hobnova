// scripts/*.mjsの主要CLIは、importするだけでmain()が実行されてしまう不具合を過去に
// 実際に起こしている（daily-publish-check.mjsのimportが本当にPRをマージした事故）。
// このテストは、それぞれのファイルをimportした時点でgit/gh/fetchの呼び出しが
// 一切発生しないこと（= entry-point guardが機能していること）を明示的に検証する。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const execFileMock = vi.fn();
const fetchMock = vi.fn();

vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => {
    const cb = args[args.length - 1] as (err: Error | null, result: { stdout: string; stderr: string }) => void;
    execFileMock(...args.slice(0, -1));
    cb(null, { stdout: '', stderr: '' });
  },
}));

vi.stubGlobal('fetch', fetchMock);

beforeEach(() => {
  execFileMock.mockReset();
  fetchMock.mockReset();
});

afterEach(() => {
  vi.resetModules();
});

describe('import時に副作用が発生しないこと（entry-point guard）', () => {
  it('daily-publish-check.mjsをimportしてもgit/gh/fetchが呼ばれない', async () => {
    await expect(import('../daily-publish-check.mjs')).resolves.toBeDefined();
    expect(execFileMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('notify-article-ready.mjsをimportしてもgit/gh/fetchが呼ばれない', async () => {
    await expect(import('../notify-article-ready.mjs')).resolves.toBeDefined();
    expect(execFileMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('news-publish.mjsをimportしてもgit/gh/fetch/OpenAIが呼ばれない', async () => {
    await expect(import('../news-publish.mjs')).resolves.toBeDefined();
    expect(execFileMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refresh-rakuten-affiliate-links.mjsをimportしてもSecret必須チェックのthrowやfetchが起きない', async () => {
    // OPENAI等と同様、必須env未設定でも「importしただけ」ではエラーにならないことを確認する
    // （guard無しの場合は、このimport自体が即座にMissing required secretで失敗する）。
    await expect(import('../refresh-rakuten-affiliate-links.mjs')).resolves.toBeDefined();
    expect(execFileMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
