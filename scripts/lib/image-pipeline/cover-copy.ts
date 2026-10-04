export interface CoverCopy {
  line1: string;
  line2: string;
}

const MIN_TOTAL_CHARS = 10;
const MAX_TOTAL_CHARS = 24;
const MAX_LINE_CHARS = 16;

// タイトル前半の「フック」を見つけるための区切り文字（？！を優先、見つからなければ｜:：、）。
const HOOK_PATTERN = /^(.{2,24}?[？！])/;
const SECONDARY_SPLIT_PATTERN = /^(.{2,30}?)[｜:：、]/;

function stripTrailingPunctuation(text: string): string {
  return text.replace(/[。、・\s]+$/, '');
}

/**
 * maxCharsで切り詰める。ただし半角英数字の連続（ANSI, 320MHz等）の途中では切らず、
 * その連続の手前まで戻ってから切る（単語の途中で千切れた見た目の悪いコピーを避ける）。
 */
function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  let cut = maxChars;
  const isAlnum = (ch: string) => /[A-Za-z0-9]/.test(ch);
  while (cut > 0 && isAlnum(text[cut - 1]) && isAlnum(text[cut])) {
    cut--;
  }
  return text.slice(0, cut);
}

/**
 * タイトル後半（line1として使った部分より後ろ）から、「〜を(ジャーゴン列挙)で/に(要約動詞)」
 * というパターンを検出し、ジャーゴン列挙部分（・区切りの専門用語の羅列）を省いて短く圧縮する。
 * 例: "Wi-Fi 6Eとの違いを320MHz・MLO・6GHzで整理" -> "Wi-Fi 6Eとの違いを整理"
 * パターンに一致しない場合はnullを返す（呼び出し側でdescriptionベースにフォールバックする）。
 */
function compressJargonList(remainder: string): string | null {
  const match = /^(.+?を)(.+?)(で|に)(.{1,10})$/.exec(remainder);
  if (!match) return null;

  const [, lead, jargon, , tail] = match;
  // ジャーゴン列挙らしさの判定: ・を含む、またはアルファベット+数字の塊を含む
  const looksLikeJargonList = /[・]/.test(jargon) || /[A-Za-z]{2,}\d|\d[A-Za-z]{2,}/.test(jargon);
  if (!looksLikeJargonList) return null;

  const compressed = stripTrailingPunctuation(lead + tail);
  return compressed.length > 0 ? compressed : null;
}

function firstClause(text: string, maxChars: number): string {
  const normalized = text.trim();
  const periodIndex = normalized.search(/[。、]/);
  const clause = periodIndex > 0 ? normalized.slice(0, periodIndex) : normalized;
  return truncate(stripTrailingPunctuation(clause), maxChars);
}

/**
 * アイキャッチ用の短い日本語コピーを、タイトル・descriptionからルールベースで生成する。
 * LLMによる要約は行わない（決定的・テスト可能にするため）。そのため、タイトルの構造に
 * よっては必ずしも理想的な圧縮にならない場合がある点に留意（呼び出し元のレポートで明示する）。
 *
 * 方針:
 * 1. line1: タイトル前半の「？/！」までのフック部分（見つからなければ｜:： 、までの句、
 *    それも無ければタイトル先頭を短く切り出す）。いずれも最終的に単語境界を壊さない形で
 *    MAX_LINE_CHARSへ切り詰める。
 * 2. line2: タイトル残り部分から「を(ジャーゴン列挙)で/に要約動詞」パターンを検出して圧縮。
 *    検出できなければ description の最初の句を使う
 */
export function buildCoverCopy(title: string, description: string): CoverCopy {
  const trimmedTitle = title.trim();

  let rawLine1: string;
  let remainderStart: number;

  const hookMatch = HOOK_PATTERN.exec(trimmedTitle);
  if (hookMatch) {
    rawLine1 = hookMatch[1];
    remainderStart = hookMatch[1].length;
  } else {
    const secondaryMatch = SECONDARY_SPLIT_PATTERN.exec(trimmedTitle);
    if (secondaryMatch) {
      rawLine1 = secondaryMatch[1];
      remainderStart = secondaryMatch[0].length;
    } else {
      rawLine1 = trimmedTitle;
      remainderStart = trimmedTitle.length;
    }
  }

  const line1 = truncate(stripTrailingPunctuation(rawLine1), MAX_LINE_CHARS);
  const remainder = stripTrailingPunctuation(trimmedTitle.slice(remainderStart).replace(/^[｜:：、\s]+/, ''));

  let line2 = remainder ? compressJargonList(remainder) : null;
  if (!line2 || line2.length === 0) {
    line2 = firstClause(description, MAX_LINE_CHARS) || truncate(remainder, MAX_LINE_CHARS);
  }
  line2 = truncate(line2, MAX_LINE_CHARS);

  // 合計文字数を10〜24字に収める。
  let total = line1.length + line2.length;
  if (total > MAX_TOTAL_CHARS) {
    line2 = truncate(line2, Math.max(1, MAX_TOTAL_CHARS - line1.length));
    total = line1.length + line2.length;
  }
  if (total < MIN_TOTAL_CHARS && description) {
    const extra = firstClause(description, MIN_TOTAL_CHARS - total + line2.length);
    if (extra.length > line2.length) line2 = truncate(extra, MAX_LINE_CHARS);
  }

  return { line1, line2 };
}
