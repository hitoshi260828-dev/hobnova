// 直近N日分のnews記事からsource URLを集め、同じニュースを朝夜・日またぎで
// 重複掲載しないための簡易チェック。複雑なDBは使わず、チェックアウト済みワークツリーの
// src/content/news/*.md をその場で読む（daily-publish-check.mjsの冪等性チェックと同じ方式）。
import fs from "node:fs";
import path from "node:path";

const LOOKBACK_DAYS = 3;

function parseFrontmatterSources(source) {
  // frontmatterブロックの範囲内に限定する（\r?\nでCRLF/LF両対応。Windows上のgit
  // checkoutではcore.autocrlfによりCRLFになることがあり、実際にこれで検出漏れが発生した）。
  const block = source.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  if (!block) return [];
  // sourcesスキーマでは `url:` キーはsources[].url以外に出現しないため、ブロック内の
  // `url: "..."` 行を素直に全て拾えば十分（ネストされたYAML構造を厳密にパースする必要がない）。
  return [...block[1].matchAll(/^\s*url:\s*["']?(https?:\/\/[^\s"'\r]+)["']?/gm)].map((m) => m[1]);
}

/** 直近LOOKBACK_DAYS日分のnews記事で既に使われているsource URLの集合を返す。 */
export function collectRecentSourceUrls(repoRoot, { today = new Date(), lookbackDays = LOOKBACK_DAYS } = {}) {
  const dir = path.join(repoRoot, "src/content/news");
  if (!fs.existsSync(dir)) return new Set();

  const cutoff = new Date(today.getTime() - lookbackDays * 24 * 60 * 60 * 1000);
  const urls = new Set();

  for (const file of fs.readdirSync(dir)) {
    if (!/\.(md|mdx)$/.test(file)) continue;
    // ファイル名が {YYYY-MM-DD}-{edition}.md のため、日付部分だけで直近判定できる
    // （frontmatterをパースしなくても軽量にlookback判定できる）。
    const dateMatch = file.match(/^(\d{4}-\d{2}-\d{2})-(morning|evening)\.(md|mdx)$/);
    if (!dateMatch) continue;
    const fileDate = new Date(`${dateMatch[1]}T00:00:00Z`);
    if (fileDate < cutoff) continue;

    const source = fs.readFileSync(path.join(dir, file), "utf8");
    for (const url of parseFrontmatterSources(source)) urls.add(url);
  }

  return urls;
}

/** 収集したニュース候補から、直近で既出のsource URLを持つものを除外する。 */
export function filterDuplicates(candidates, recentUrls) {
  return candidates.filter((item) => !item.sourceUrl || !recentUrls.has(item.sourceUrl));
}
