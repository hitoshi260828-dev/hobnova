// scripts/*.mjsの主要CLIは、importするだけでmain()が実行されてしまう不具合を過去に
// 実際に起こしている（daily-publish-check.mjsのimportが本当にPRをマージした事故）。
// このテストは、それぞれのファイルをimportした時点でgit/gh/fetchの呼び出しが
// 一切発生しないこと（= entry-point guardが機能していること）を明示的に検証する。
//
// 重要: 各ファイルのmain()は、必須env/argが無いと（guardが機能していなくても）
// execFile/fetchへ到達する前にthrowして終わる。そのthrowはimport側の.catch()に
// 吸収されるため、「呼ばれていない」というassertionはguardが機能していなくても
// 偶然passしてしまう（vacuous pass）。これを防ぐため、各テストではmain()が実際に
// execFile/fetchへ到達するために必要な最小限のenv/argをすべて設定した状態でimportする。
// guardが正しく機能していればそれでもmain()自体が走らないため、呼び出しは0件のままになる
// ——これが「guardが壊れていたら検出できる」テストの条件である。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const execFileMock = vi.fn();
const fetchMock = vi.fn();
const ORIGINAL_ENV = { ...process.env };

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
  process.env = { ...ORIGINAL_ENV };
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.resetModules();
});

describe('import時に副作用が発生しないこと（entry-point guard）', () => {
  it('daily-publish-check.mjsをimportしてもgit/gh/fetchが呼ばれない', async () => {
    // このファイルのmain()はenv/argなしでも最初にlistOpenContentPRs()(=execFile)へ
    // 到達するため、追加のenv設定なしでも元々vacuousではない。
    await expect(import('../daily-publish-check.mjs')).resolves.toBeDefined();
    expect(execFileMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('notify-article-ready.mjsをimportしてもgit/gh/fetchが呼ばれない', async () => {
    // PR_NUMBER/HEAD_SHA未設定だと最初のif文でthrowし、LINE未設定だとその次のreturnで
    // 終わってしまい、どちらもexecFileへ到達せずテストが意味を持たない。guardが機能して
    // いることを本当に検証するため、main()が実際にgetChangedArticle()(=execFile)まで
    // 到達できる状態（必須env全て設定・dry-run無し）にしてimportする。
    process.env.PR_NUMBER = '1';
    process.env.HEAD_SHA = 'deadbeef';
    process.env.LINE_CHANNEL_ACCESS_TOKEN = 'dummy-token';
    process.env.LINE_USER_ID = 'dummy-user';
    delete process.env.DRY_RUN;
    await expect(import('../notify-article-ready.mjs')).resolves.toBeDefined();
    expect(execFileMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('news-publish.mjsをimportしてもgit/gh/fetch/OpenAIが呼ばれない', async () => {
    // EDITION未設定だと最初のif文でthrowしてfindOpenPrForBranch()(=execFile)へ到達しない。
    // guardの検証として意味を持たせるため、到達可能な状態にしてimportする。
    process.env.EDITION = 'morning';
    delete process.env.DRY_RUN;
    await expect(import('../news-publish.mjs')).resolves.toBeDefined();
    expect(execFileMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refresh-rakuten-affiliate-links.mjsをimportしてもSecret必須チェックのthrowやfetchが起きない', async () => {
    // 必須Secret未設定だと最初のチェックでthrowしてfetch()へ到達しないため、guardの
    // 検証として意味を持たせるため必須envを全て設定した状態でimportする。
    process.env.RAKUTEN_APPLICATION_ID = 'dummy';
    process.env.RAKUTEN_ACCESS_KEY = 'dummy';
    process.env.RAKUTEN_AFFILIATE_ID = 'dummy';
    await expect(import('../refresh-rakuten-affiliate-links.mjs')).resolves.toBeDefined();
    expect(execFileMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
