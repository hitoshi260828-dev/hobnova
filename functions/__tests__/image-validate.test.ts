import { describe, expect, it } from 'vitest';
import { bytesToBase64, validateArticlePath, validateImageInput, MAX_IMAGE_BYTES } from '../_lib/image-validate';

const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0xff, 0xff,
]);
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
const WEBP_BYTES = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0xff, 0xff,
]);
const SVG_AS_PNG_BYTES = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');

describe('validateArticlePath', () => {
  it('articles配下の.mdを許可する', () => {
    const result = validateArticlePath('src/content/articles/laptop-buying-guide.md');
    expect(result.valid).toBe(true);
    expect(result.slug).toBe('laptop-buying-guide');
    expect(result.dir).toBe('src/content/articles/');
  });

  it('data-lab配下の.mdを許可する', () => {
    const result = validateArticlePath('src/content/data-lab/camp-market-trend.md');
    expect(result.valid).toBe(true);
    expect(result.dir).toBe('src/content/data-lab/');
  });

  it('tools配下の.mdxを許可する', () => {
    const result = validateArticlePath('src/content/tools/rent-vs-buy-simulator.mdx');
    expect(result.valid).toBe(true);
  });

  it('許可されていないディレクトリは拒否する', () => {
    expect(validateArticlePath('src/pages/index.astro').valid).toBe(false);
    expect(validateArticlePath('functions/api/mcp.ts').valid).toBe(false);
  });

  it('path traversalを拒否する', () => {
    expect(validateArticlePath('src/content/articles/../../etc/passwd').valid).toBe(false);
    expect(validateArticlePath('src/content/articles/../secrets.md').valid).toBe(false);
  });

  it('絶対パス・ドライブレターを拒否する', () => {
    expect(validateArticlePath('/etc/passwd').valid).toBe(false);
    expect(validateArticlePath('C:/Windows/system32').valid).toBe(false);
  });

  it('サブディレクトリを拒否する（各コレクションはフラット構成）', () => {
    expect(validateArticlePath('src/content/articles/sub/dir.md').valid).toBe(false);
  });

  it('未対応の拡張子を拒否する', () => {
    expect(validateArticlePath('src/content/articles/laptop-buying-guide.txt').valid).toBe(false);
  });

  it('null byteを拒否する', () => {
    expect(validateArticlePath('src/content/articles/x\0.md').valid).toBe(false);
  });

  it('文字列以外・空文字を拒否する', () => {
    expect(validateArticlePath(undefined).valid).toBe(false);
    expect(validateArticlePath(123).valid).toBe(false);
    expect(validateArticlePath('').valid).toBe(false);
  });
});

describe('validateImageInput', () => {
  it('有効なPNG（raw base64）を受け付ける', () => {
    const result = validateImageInput({ data: bytesToBase64(PNG_BYTES), mime_type: 'image/png' });
    expect(result.valid).toBe(true);
    expect(result.extension).toBe('png');
    expect(result.bytes?.length).toBe(PNG_BYTES.length);
  });

  it('有効なJPEGを受け付ける', () => {
    const result = validateImageInput({ data: bytesToBase64(JPEG_BYTES), mime_type: 'image/jpeg' });
    expect(result.valid).toBe(true);
    expect(result.extension).toBe('jpg');
  });

  it('有効なWebPを受け付ける', () => {
    const result = validateImageInput({ data: bytesToBase64(WEBP_BYTES), mime_type: 'image/webp' });
    expect(result.valid).toBe(true);
    expect(result.extension).toBe('webp');
  });

  it('data URL形式（data:image/png;base64,...）も受け付ける', () => {
    const result = validateImageInput({ data: `data:image/png;base64,${bytesToBase64(PNG_BYTES)}` });
    expect(result.valid).toBe(true);
    expect(result.extension).toBe('png');
  });

  it('未対応のmime_type（SVG等）を拒否する', () => {
    const result = validateImageInput({ data: bytesToBase64(SVG_AS_PNG_BYTES), mime_type: 'image/svg+xml' });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/unsupported mime_type/);
  });

  it('mime_typeとマジックバイトが一致しない場合は拒否する（SVGをPNGと偽装）', () => {
    const result = validateImageInput({ data: bytesToBase64(SVG_AS_PNG_BYTES), mime_type: 'image/png' });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/do not match declared mime_type/);
  });

  it('不正なbase64を拒否する', () => {
    const result = validateImageInput({ data: '!!!not-base64!!!', mime_type: 'image/png' });
    expect(result.valid).toBe(false);
  });

  it('サイズ上限を超える画像を拒否する', () => {
    const big = new Uint8Array(MAX_IMAGE_BYTES + 1);
    big.set(PNG_BYTES);
    const result = validateImageInput({ data: bytesToBase64(big), mime_type: 'image/png' });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/exceeds max size/);
  });

  it('imageが未指定なら拒否する', () => {
    expect(validateImageInput(undefined).valid).toBe(false);
  });

  it('data未指定なら拒否する', () => {
    expect(validateImageInput({ mime_type: 'image/png' }).valid).toBe(false);
  });
});

describe('bytesToBase64', () => {
  it('大きなバイト列でもスタックオーバーフローせずエンコードできる', () => {
    const big = new Uint8Array(500_000).fill(65);
    expect(() => bytesToBase64(big)).not.toThrow();
    expect(bytesToBase64(big).length).toBeGreaterThan(0);
  });
});
