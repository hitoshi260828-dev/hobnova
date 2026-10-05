// frontmatterの `image:` フィールドだけを読み書きする軽量ユーティリティ。
//
// scripts/側（Node実行）はgray-matterで全体をパース・再stringifyしているが、それをそのまま
// Workers側へ持ち込むと、関係ない他フィールドまでYAMLスタイル（クォート有無・日付形式等）が
// 再整形されてしまう副作用がある（過去にPRで実際に発生した既知の挙動）。
// Worker側はMCP経由の自動PRであり差分を最小限にしたいため、対象行だけを正規表現で
// 置換/挿入し、それ以外は一切変更しない方式にする。
const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/;
const IMAGE_LINE_PATTERN = /^image:[^\n]*$/m;
// 置換専用。gフラグ付き正規表現はlastIndexを保持するため、.test()と共有せず分離する
// （モジュールスコープの正規表現はWorkerのisolate内で複数リクエストにまたがって再利用されうる）。
const IMAGE_LINE_PATTERN_GLOBAL = /^image:[^\n]*$/gm;

export interface FrontmatterInfo {
  hasFrontmatter: boolean;
  image: string | null;
}

/** 現在のfrontmatterから`image:`の値（クォート除去済み）を読み取る。 */
export function readFrontmatterImage(markdownSource: string): FrontmatterInfo {
  const match = FRONTMATTER_PATTERN.exec(markdownSource);
  if (!match) return { hasFrontmatter: false, image: null };

  const block = match[1];
  const imageMatch = /^image:\s*(.*)$/m.exec(block);
  if (!imageMatch) return { hasFrontmatter: true, image: null };

  const raw = imageMatch[1].trim();
  if (raw.length === 0) return { hasFrontmatter: true, image: null };

  const unquoted =
    (raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))
      ? raw.slice(1, -1)
      : raw;

  return { hasFrontmatter: true, image: unquoted };
}

/**
 * frontmatter内の`image:`フィールドを更新する（既存なら置換、無ければ追加）。
 * frontmatterブロック以外（本文）は一切変更しない。
 */
export function writeFrontmatterImage(markdownSource: string, imagePath: string): string {
  const match = FRONTMATTER_PATTERN.exec(markdownSource);
  if (!match) {
    throw new Error('markdown source has no frontmatter block');
  }

  const newLine = `image: "${imagePath}"`;
  const block = match[1];

  const newBlock = IMAGE_LINE_PATTERN.test(block)
    ? block.replace(IMAGE_LINE_PATTERN_GLOBAL, newLine)
    : `${block}\n${newLine}`;

  // match[1]（block）はmatch[0]内の「開始区切り行の直後」から始まる固定位置にあるため、
  // 文字列置換ではなく位置計算で安全に組み立てる。
  const blockStartInMatch = match[0].indexOf(block);
  const before = markdownSource.slice(0, match.index) + match[0].slice(0, blockStartInMatch);
  const after = markdownSource.slice(match.index + match[0].length);
  return before + newBlock + match[0].slice(blockStartInMatch + block.length) + after;
}
