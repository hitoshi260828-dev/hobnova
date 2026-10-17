import { describe, expect, it } from 'vitest';
import { clearNewsDraftFlag, readFrontmatterImage, writeFrontmatterImage } from '../_lib/frontmatter-patch';

const NO_IMAGE_MD = `---
title: "用途別に選ぶノートPCの選び方2026"
description: "テスト用の説明文です。"
publishDate: 2026-08-10
category: "gadget"
tags: ["PC", "購入ガイド"]
draft: false
featured: false
---

本文です。
`;

const WITH_IMAGE_MD = `---
title: "既存cover付き記事"
description: "テスト用の説明文です。"
publishDate: 2026-08-10
image: "./existing-hero.svg"
draft: false
---

本文です。
`;

const CRLF_MD = NO_IMAGE_MD.replace(/\n/g, '\r\n');

describe('readFrontmatterImage', () => {
  it('imageフィールドが無ければimage: nullを返す', () => {
    const result = readFrontmatterImage(NO_IMAGE_MD);
    expect(result.hasFrontmatter).toBe(true);
    expect(result.image).toBeNull();
  });

  it('imageフィールドがあればクォートを外して返す', () => {
    const result = readFrontmatterImage(WITH_IMAGE_MD);
    expect(result.image).toBe('./existing-hero.svg');
  });

  it('frontmatterが無ければhasFrontmatter: falseを返す', () => {
    const result = readFrontmatterImage('# ただのMarkdown\n\n本文のみです。');
    expect(result.hasFrontmatter).toBe(false);
    expect(result.image).toBeNull();
  });

  it('CRLF改行でも正しく読める', () => {
    const result = readFrontmatterImage(CRLF_MD);
    expect(result.hasFrontmatter).toBe(true);
    expect(result.image).toBeNull();
  });
});

describe('writeFrontmatterImage', () => {
  it('imageフィールドが無ければ新規追加する', () => {
    const updated = writeFrontmatterImage(NO_IMAGE_MD, './laptop-buying-guide-hero.png');
    const reread = readFrontmatterImage(updated);
    expect(reread.image).toBe('./laptop-buying-guide-hero.png');
    // 本文・他フィールドは変更されない
    expect(updated).toContain('title: "用途別に選ぶノートPCの選び方2026"');
    expect(updated).toContain('本文です。');
  });

  it('既存のimageフィールドを置き換える', () => {
    const updated = writeFrontmatterImage(WITH_IMAGE_MD, './existing-hero.png');
    const reread = readFrontmatterImage(updated);
    expect(reread.image).toBe('./existing-hero.png');
    expect(updated).not.toContain('existing-hero.svg');
  });

  it('frontmatter以外の部分は1バイトも変更しない', () => {
    const updated = writeFrontmatterImage(NO_IMAGE_MD, './x-hero.png');
    const body = updated.split(/^---\r?\n[\s\S]*?\r?\n---\r?\n/)[1];
    const originalBody = NO_IMAGE_MD.split(/^---\r?\n[\s\S]*?\r?\n---\r?\n/)[1];
    expect(body).toBe(originalBody);
  });

  it('他のfrontmatterフィールドの値・クォートスタイルを変更しない（既知のgray-matter再整形問題を回避）', () => {
    const updated = writeFrontmatterImage(NO_IMAGE_MD, './x-hero.png');
    expect(updated).toContain('publishDate: 2026-08-10');
    expect(updated).toContain('tags: ["PC", "購入ガイド"]');
    expect(updated).toContain('featured: false');
  });

  it('frontmatterが無ければ例外を投げる', () => {
    expect(() => writeFrontmatterImage('# frontmatterなし', './x.png')).toThrow(/no frontmatter/);
  });

  it('CRLF改行のファイルでも正しく書き換えられる', () => {
    const updated = writeFrontmatterImage(CRLF_MD, './x-hero.png');
    const reread = readFrontmatterImage(updated);
    expect(reread.image).toBe('./x-hero.png');
  });
});

const NEWS_PENDING_COVER_MD = `---
title: "朝のニュース"
description: "テスト用の説明文です。"
publishedAt: 2026-10-20T08:00:00+09:00
edition: morning
draft: true
---

本文です。
`;

describe('readFrontmatterImage / writeFrontmatterImage with fieldName (NEWSの cover: フィールド)', () => {
  it('newsはimage:ではなくcover:フィールドを読み書きする', () => {
    const result = readFrontmatterImage(NEWS_PENDING_COVER_MD, 'cover');
    expect(result.hasFrontmatter).toBe(true);
    expect(result.image).toBeNull();

    const updated = writeFrontmatterImage(NEWS_PENDING_COVER_MD, './2026-10-20-morning-hero.png', 'cover');
    expect(readFrontmatterImage(updated, 'cover').image).toBe('./2026-10-20-morning-hero.png');
    // image:フィールドは書かれない（news schemaにはimage:が存在せず、誤って書くと
    // Zodのデフォルト挙動で静かに無視され、coverが永遠に反映されない不具合になる）。
    expect(updated).not.toMatch(/^image:/m);
  });
});

describe('clearNewsDraftFlag', () => {
  it('draft: trueをdraft: falseへ切り替える', () => {
    const updated = clearNewsDraftFlag(NEWS_PENDING_COVER_MD);
    expect(updated).toContain('draft: false');
    expect(updated).not.toMatch(/draft:\s*true/);
  });

  it('既にdraft: falseならno-op', () => {
    const alreadyFalse = NEWS_PENDING_COVER_MD.replace('draft: true', 'draft: false');
    expect(clearNewsDraftFlag(alreadyFalse)).toBe(alreadyFalse);
  });

  it('draft行が無ければno-op', () => {
    expect(clearNewsDraftFlag(NO_IMAGE_MD.replace(/draft: false\n/, ''))).toBe(NO_IMAGE_MD.replace(/draft: false\n/, ''));
  });

  it('frontmatterが無ければそのまま返す', () => {
    const src = '# frontmatterなし';
    expect(clearNewsDraftFlag(src)).toBe(src);
  });
});
