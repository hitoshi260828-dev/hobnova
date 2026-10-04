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
  const parsed = matter(raw);
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

/** 既存の本文（inline）画像が1枚でも存在するか判定する。 */
export function hasExistingInlineImages(repoRoot: string, slug: string): boolean {
  const dir = publicInlineImageDir(repoRoot, slug);
  if (!fs.existsSync(dir)) return false;
  return fs
    .readdirSync(dir)
    .some((name) => /^inline-\d+\.(png|jpe?g|webp)$/i.test(name));
}

export function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}
