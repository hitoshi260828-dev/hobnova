import { describe, expect, it } from 'vitest';
import { parseImportArgs } from '../lib/image-pipeline/import-cli-args';

describe('parseImportArgs', () => {
  it('cover向けの最小引数を解釈できる', () => {
    const options = parseImportArgs(['--article', 'a.md', '--image', 'i.png', '--type', 'cover']);
    expect(options).toEqual({
      articlePath: 'a.md',
      imagePath: 'i.png',
      type: 'cover',
      afterHeading: undefined,
      position: undefined,
      alt: undefined,
      copyOnly: false,
      dryRun: false,
      force: false,
    });
  });

  it('inline向け: --after-headingを解釈できる', () => {
    const options = parseImportArgs([
      '--article', 'a.md', '--image', 'i.jpg', '--type', 'inline', '--after-heading', '見出しテキスト',
    ]);
    expect(options.afterHeading).toBe('見出しテキスト');
  });

  it('inline向け: --positionを数値として解釈できる', () => {
    const options = parseImportArgs(['--article', 'a.md', '--image', 'i.jpg', '--type', 'inline', '--position', '2']);
    expect(options.position).toBe(2);
  });

  it('真偽値フラグ（--dry-run --force --copy-only）を解釈できる', () => {
    const options = parseImportArgs([
      '--article', 'a.md', '--image', 'i.png', '--type', 'cover', '--dry-run', '--force', '--copy-only',
    ]);
    expect(options.dryRun).toBe(true);
    expect(options.force).toBe(true);
    expect(options.copyOnly).toBe(true);
  });

  it('--articleが無ければエラー', () => {
    expect(() => parseImportArgs(['--image', 'i.png', '--type', 'cover'])).toThrow(/--article/);
  });

  it('--imageが無ければエラー', () => {
    expect(() => parseImportArgs(['--article', 'a.md', '--type', 'cover'])).toThrow(/--image/);
  });

  it('--typeがcover/inline以外はエラー', () => {
    expect(() => parseImportArgs(['--article', 'a.md', '--image', 'i.png', '--type', 'xxx'])).toThrow(/--type/);
  });

  it('inlineで--after-headingも--positionも無ければエラー', () => {
    expect(() => parseImportArgs(['--article', 'a.md', '--image', 'i.jpg', '--type', 'inline'])).toThrow(
      /--after-heading.*--position/
    );
  });

  it('--positionが数値でなければエラー', () => {
    expect(() =>
      parseImportArgs(['--article', 'a.md', '--image', 'i.jpg', '--type', 'inline', '--position', 'abc'])
    ).toThrow(/--position/);
  });

  it('--positionが0以下ならエラー', () => {
    expect(() =>
      parseImportArgs(['--article', 'a.md', '--image', 'i.jpg', '--type', 'inline', '--position', '0'])
    ).toThrow(/--position/);
  });
});
