import { describe, expect, it } from 'vitest';
import { publishedAtIso, todayJst } from '../news-publish.mjs';

describe('todayJst', () => {
  it('FORCE_DATEが指定されていればそのまま返す', () => {
    expect(todayJst('2026-10-18')).toBe('2026-10-18');
  });

  it('FORCE_DATEの形式が不正ならエラーを投げる', () => {
    expect(() => todayJst('2026/10/18')).toThrow(/FORCE_DATE/);
    expect(() => todayJst('not-a-date')).toThrow(/FORCE_DATE/);
  });

  it('FORCE_DATE省略時はYYYY-MM-DD形式の日付を返す', () => {
    expect(todayJst(undefined)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('publishedAtIso', () => {
  it('朝版は08:00 JSTを返す', () => {
    expect(publishedAtIso('2026-10-18', 'morning')).toBe('2026-10-18T08:00:00+09:00');
  });

  it('夜版は20:00 JSTを返す', () => {
    expect(publishedAtIso('2026-10-18', 'evening')).toBe('2026-10-18T20:00:00+09:00');
  });
});
