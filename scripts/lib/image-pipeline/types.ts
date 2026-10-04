export interface ArticleSection {
  /** H2見出しのテキスト（# は含まない） */
  heading: string;
  /** その見出し直下〜次の見出し直前までの本文（見出し行自体は含まない） */
  body: string;
  /** 元のMarkdown内で、この見出し行が始まる文字インデックス */
  headingStartIndex: number;
  /** 見出し行の終わり（本文開始位置）の文字インデックス */
  headingEndIndex: number;
}

export type InlineImageStyle =
  | 'clean-object-composition'
  | 'product-editorial'
  | 'lifestyle-photography-like'
  | 'realistic-spatial-composition';

export interface SelectedSection {
  section: ArticleSection;
  style: InlineImageStyle;
  /** 選定理由（ログ・デバッグ用） */
  reason: string;
}

export interface CliOptions {
  articlePath: string;
  force: boolean;
  coverOnly: boolean;
  inlineOnly: boolean;
  dryRun: boolean;
}

export interface GeneratedImage {
  /** 保存した実ファイルパス（リポジトリルートからの相対パス） */
  filePath: string;
  /** Markdown/frontmatterから参照する際のパス */
  referencePath: string;
  alt?: string;
}

export interface PlanItem {
  kind: 'cover' | 'inline';
  targetPath: string;
  prompt: string;
  alt?: string;
  heading?: string;
}
