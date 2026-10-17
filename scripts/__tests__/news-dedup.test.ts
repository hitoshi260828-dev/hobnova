import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { collectRecentSourceUrls, filterDuplicates } from '../lib/news/dedup.mjs';

const MORNING_MD = (date: string, url: string) => `---
title: "テスト"
description: "テスト"
publishedAt: ${date}T08:00:00+09:00
edition: morning
cover: "./hero.png"
topics:
  - ai
draft: false
sources:
  - name: "Example"
    url: "${url}"
    accessedDate: ${date}
---

本文
`;

describe('collectRecentSourceUrls', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hobnova-news-dedup-'));
    fs.mkdirSync(path.join(tmpDir, 'src/content/news'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('ディレクトリが無ければ空集合を返す', () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hobnova-news-empty-'));
    expect(collectRecentSourceUrls(emptyDir).size).toBe(0);
    fs.rmSync(emptyDir, { recursive: true, force: true });
  });

  it('直近lookback日数以内のファイルのsource URLを収集する', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'src/content/news/2026-10-18-morning.md'),
      MORNING_MD('2026-10-18', 'https://example.com/today')
    );
    const urls = collectRecentSourceUrls(tmpDir, { today: new Date('2026-10-18T00:00:00Z'), lookbackDays: 3 });
    expect(urls.has('https://example.com/today')).toBe(true);
  });

  it('lookback日数より古いファイルは除外する', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'src/content/news/2026-10-01-morning.md'),
      MORNING_MD('2026-10-01', 'https://example.com/old')
    );
    const urls = collectRecentSourceUrls(tmpDir, { today: new Date('2026-10-18T00:00:00Z'), lookbackDays: 3 });
    expect(urls.has('https://example.com/old')).toBe(false);
  });

  it('同日の朝版・夜版どちらのURLも集める', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'src/content/news/2026-10-18-morning.md'),
      MORNING_MD('2026-10-18', 'https://example.com/morning-item')
    );
    fs.writeFileSync(
      path.join(tmpDir, 'src/content/news/2026-10-18-evening.md'),
      MORNING_MD('2026-10-18', 'https://example.com/evening-item').replace('edition: morning', 'edition: evening')
    );
    const urls = collectRecentSourceUrls(tmpDir, { today: new Date('2026-10-18T12:00:00Z'), lookbackDays: 3 });
    expect(urls.has('https://example.com/morning-item')).toBe(true);
    expect(urls.has('https://example.com/evening-item')).toBe(true);
  });

  it('命名規則に合わないファイルは無視する', () => {
    fs.writeFileSync(path.join(tmpDir, 'src/content/news/random-name.md'), MORNING_MD('2026-10-18', 'https://example.com/x'));
    const urls = collectRecentSourceUrls(tmpDir, { today: new Date('2026-10-18T00:00:00Z') });
    expect(urls.size).toBe(0);
  });

  it('CRLF改行のファイルでもsource URLを検出する（Windows上のgit checkoutで実際に発生した不具合の回帰テスト）', () => {
    const crlfContent = MORNING_MD('2026-10-18', 'https://example.com/crlf-test').replace(/\n/g, '\r\n');
    fs.writeFileSync(path.join(tmpDir, 'src/content/news/2026-10-18-morning.md'), crlfContent);
    const urls = collectRecentSourceUrls(tmpDir, { today: new Date('2026-10-18T00:00:00Z'), lookbackDays: 3 });
    expect(urls.has('https://example.com/crlf-test')).toBe(true);
  });

  it('複数件のsourcesを持つファイルから全URLを検出する', () => {
    const multiSource = `---
title: "テスト"
publishedAt: 2026-10-18T08:00:00+09:00
edition: morning
sources:
  - name: "A"
    url: "https://example.com/multi-a"
    accessedDate: 2026-10-18
  - name: "B"
    url: "https://example.com/multi-b"
    accessedDate: 2026-10-18
---

本文
`;
    fs.writeFileSync(path.join(tmpDir, 'src/content/news/2026-10-18-evening.md'), multiSource);
    const urls = collectRecentSourceUrls(tmpDir, { today: new Date('2026-10-18T00:00:00Z'), lookbackDays: 3 });
    expect(urls.has('https://example.com/multi-a')).toBe(true);
    expect(urls.has('https://example.com/multi-b')).toBe(true);
  });
});

describe('filterDuplicates', () => {
  it('recentUrlsに含まれるsourceUrlの候補を除外する', () => {
    const recent = new Set(['https://example.com/used']);
    const candidates = [
      { sourceUrl: 'https://example.com/used', heading: 'A' },
      { sourceUrl: 'https://example.com/new', heading: 'B' },
    ];
    const result = filterDuplicates(candidates, recent);
    expect(result).toHaveLength(1);
    expect(result[0].heading).toBe('B');
  });

  it('sourceUrlが無い候補は除外しない', () => {
    const result = filterDuplicates([{ heading: 'no url' }], new Set());
    expect(result).toHaveLength(1);
  });
});
