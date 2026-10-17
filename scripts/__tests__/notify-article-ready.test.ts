import { describe, expect, it } from 'vitest';
import { buildFallbackMessage, buildMessage } from '../notify-article-ready.mjs';

describe('buildMessage', () => {
  it('title/summary/previewUrl/prUrlを含むメッセージを作る', () => {
    const message = buildMessage({
      title: 'テスト記事',
      summary: '概要です',
      previewUrl: 'https://preview.example/',
      prUrl: 'https://github.com/x/y/pull/1',
    });
    expect(message).toContain('テスト記事');
    expect(message).toContain('概要です');
    expect(message).toContain('https://preview.example/');
    expect(message).toContain('https://github.com/x/y/pull/1');
  });
});

describe('buildFallbackMessage', () => {
  it('previewUrl無しでもtitle/summary/prUrl/reasonを含むメッセージを作る（通知を失わないための要件）', () => {
    const message = buildFallbackMessage({
      title: 'テスト記事',
      summary: '概要です',
      prUrl: 'https://github.com/x/y/pull/57',
      reason: 'Cloudflare Pagesのデプロイコメントを検出できませんでした。',
    });
    expect(message).toContain('テスト記事');
    expect(message).toContain('概要です');
    expect(message).toContain('https://github.com/x/y/pull/57');
    expect(message).toContain('Cloudflare Pagesのデプロイコメントを検出できませんでした。');
    expect(message).not.toContain('undefined');
  });
});
