// frontmatterの `image:` フィールドだけを読み書きする軽量ユーティリティ。
//
// scripts/側（Node実行）はgray-matterで全体をパース・再stringifyしているが、それをそのまま
// Workers側へ持ち込むと、関係ない他フィールドまでYAMLスタイル（クォート有無・日付形式等）が
// 再整形されてしまう副作用がある（過去にPRで実際に発生した既知の挙動）。
// Worker側はMCP経由の自動PRであり差分を最小限にしたいため、対象行だけを正規表現で
// 置換/挿入し、それ以外は一切変更しない方式にする。
const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/;

export interface FrontmatterInfo {
  hasFrontmatter: boolean;
  image: string | null;
}

/**
 * 現在のfrontmatterから画像フィールドの値（クォート除去済み）を読み取る。
 * フィールド名はコレクションごとに異なる（articles/data-lab/toolsは`image:`、newsは`cover:`）ため
 * 呼び出し側（cover-publish.ts）がarticle_pathの配置先ディレクトリから決めて渡す。
 */
export function readFrontmatterImage(markdownSource: string, fieldName: string = 'image'): FrontmatterInfo {
  const match = FRONTMATTER_PATTERN.exec(markdownSource);
  if (!match) return { hasFrontmatter: false, image: null };

  const block = match[1];
  const imageMatch = new RegExp(`^${fieldName}:\\s*(.*)$`, 'm').exec(block);
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
 * frontmatter内の画像フィールド（既定`image:`、newsは`cover:`を渡す）を更新する
 * （既存なら置換、無ければ追加）。frontmatterブロック以外（本文）は一切変更しない。
 */
export function writeFrontmatterImage(markdownSource: string, imagePath: string, fieldName: string = 'image'): string {
  const match = FRONTMATTER_PATTERN.exec(markdownSource);
  if (!match) {
    throw new Error('markdown source has no frontmatter block');
  }

  const newLine = `${fieldName}: "${imagePath}"`;
  const block = match[1];
  const fieldLinePattern = new RegExp(`^${fieldName}:[^\\n]*$`, 'm');
  const fieldLinePatternGlobal = new RegExp(`^${fieldName}:[^\\n]*$`, 'gm');

  const newBlock = fieldLinePattern.test(block) ? block.replace(fieldLinePatternGlobal, newLine) : `${block}\n${newLine}`;

  // match[1]（block）はmatch[0]内の「開始区切り行の直後」から始まる固定位置にあるため、
  // 文字列置換ではなく位置計算で安全に組み立てる。
  const blockStartInMatch = match[0].indexOf(block);
  const before = markdownSource.slice(0, match.index) + match[0].slice(0, blockStartInMatch);
  const after = markdownSource.slice(match.index + match[0].length);
  return before + newBlock + match[0].slice(blockStartInMatch + block.length) + after;
}

/**
 * NEWS専用: frontmatterの`draft: true`を`draft: false`へ切り替える。cover待ち状態
 * （draft:true、cover無し）のNEWS記事へChatGPT経由でcoverが追加された時点で、
 * 同じcommitで公開状態へ切り替えるために使う。`draft: false`またはdraft行が無い場合はno-op。
 */
export function clearNewsDraftFlag(markdownSource: string): string {
  const match = FRONTMATTER_PATTERN.exec(markdownSource);
  if (!match) return markdownSource;

  const block = match[1];
  const draftTruePattern = /^draft:\s*true\s*$/m;
  if (!draftTruePattern.test(block)) return markdownSource;

  const newBlock = block.replace(draftTruePattern, 'draft: false');
  const blockStartInMatch = match[0].indexOf(block);
  const before = markdownSource.slice(0, match.index) + match[0].slice(0, blockStartInMatch);
  const after = markdownSource.slice(match.index + match[0].length);
  return before + newBlock + match[0].slice(blockStartInMatch + block.length) + after;
}
