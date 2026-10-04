import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';

export interface ArticleFile {
  /** 元のファイルパス（絶対パス） */
  absolutePath: string;
  /** 記事ファイルが置かれているディレクトリ（カバー画像をここに併置する） */
  articleDir: string;
  /** スラッグ（拡張子を除いたファイル名。サイトのURLスラッグと一致する） */
  slug: string;
  /** frontmatter（パース済みオブジェクト） */
  data: Record<string, unknown>;
  /** frontmatterを除いた本文（Markdown） */
  body: string;
}

export function loadArticleFile(articlePathInput: string): ArticleFile {
  const absolutePath = path.resolve(process.cwd(), articlePathInput);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Article file not found: ${absolutePath}`);
  }

  const raw = fs.readFileSync(absolutePath, 'utf8');
  // gray-matterは引数なし呼び出し（matter(raw)）だと「生文字列 -> 解析結果」をプロセス内で
  // グローバルキャッシュし、しかもキャッシュヒット時はdataオブジェクトの参照をそのまま返す。
  // そのため、内容が同一の記事を複数回読み込んで一方のdataを変更すると、他方にも影響してしまう
  // （実際にこの不具合でテストが汚染された）。第2引数へ空オプションを渡すとキャッシュを使わない
  // 経路になるため、明示的に {} を渡してキャッシュを無効化する。
  const parsed = matter(raw, {});
  const slug = path.basename(absolutePath).replace(/\.(md|mdx)$/i, '');

  return {
    absolutePath,
    articleDir: path.dirname(absolutePath),
    slug,
    data: parsed.data,
    body: parsed.content,
  };
}

export function writeArticleFile(article: ArticleFile): void {
  const output = matter.stringify(article.body, article.data);
  fs.writeFileSync(article.absolutePath, output, 'utf8');
}

/** 既存のアイキャッチ画像（frontmatterの image が設定済み、かつ実ファイルも存在する）か判定する。 */
export function hasExistingCover(article: ArticleFile): boolean {
  const image = article.data.image;
  if (typeof image !== 'string' || image.trim() === '') return false;

  // frontmatterの image は `./xxxx-hero.png` のような記事ディレクトリからの相対パス。
  const resolved = path.resolve(article.articleDir, image);
  return fs.existsSync(resolved);
}

export function publicInlineImageDir(repoRoot: string, slug: string): string {
  return path.join(repoRoot, 'public', 'images', 'articles', slug);
}

const INLINE_FILE_PATTERN = /^inline-(\d+)\.(png|jpe?g|webp|svg)$/i;

/** 既存の本文（inline）画像が1枚でも存在するか判定する。 */
export function hasExistingInlineImages(repoRoot: string, slug: string): boolean {
  const dir = publicInlineImageDir(repoRoot, slug);
  if (!fs.existsSync(dir)) return false;
  return fs.readdirSync(dir).some((name) => INLINE_FILE_PATTERN.test(name));
}

/** 次に使うべきinline画像の連番を返す（既存の最大値+1、無ければ1）。 */
export function nextInlineIndex(repoRoot: string, slug: string): number {
  const dir = publicInlineImageDir(repoRoot, slug);
  if (!fs.existsSync(dir)) return 1;

  const max = fs
    .readdirSync(dir)
    .map((name) => INLINE_FILE_PATTERN.exec(name))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => Number.parseInt(m[1], 10))
    .reduce((acc, n) => Math.max(acc, n), 0);

  return max + 1;
}

export function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}
