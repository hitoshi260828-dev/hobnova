// 取材結果（research.mjsの出力想定）からnews記事のMarkdown全文（frontmatter込み）を組み立てる。
import { NEWS_TOPIC_IDS } from "./topics.mjs";

function yamlString(value) {
  return JSON.stringify(value); // 日本語・記号を含んでも壊れない二重引用符エスケープとして流用
}

function yamlDate(date) {
  return date.toISOString();
}

/**
 * @param {{
 *   date: string,            // YYYY-MM-DD
 *   edition: "morning"|"evening",
 *   publishedAtIso: string,  // 完全なISO8601（JSTオフセット付き推奨）
 *   title: string,
 *   description: string,
 *   topics: string[],
 *   summary?: string,
 *   items: Array<{ heading: string, body: string, sourceName: string, sourceUrl: string, sourcePublishedDate?: string }>,
 * }} input
 */
export function buildNewsMarkdown(input) {
  const topics = input.topics.filter((t) => NEWS_TOPIC_IDS.includes(t));
  if (topics.length === 0) throw new Error("buildNewsMarkdown: topics must include at least one valid topic id");
  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new Error("buildNewsMarkdown: items must contain at least one news item");
  }

  // 2026-10-18改訂: coverRelativePathは必須ではない。OpenAI Image APIをNEWS標準ルートから
  // 外し、ChatGPT + HOBNOVA MCP（publish_generated_image）でcoverを後付けする方針に変更した
  // ため。cover未定の間は`draft: true`で非公開のまま（= 画像なしでは絶対に本番表示されない）
  // にし、cover-publish.ts（functions/_lib/cover-publish.ts）がcover追加と同じcommitで
  // `draft: false`へ切り替える。coverRelativePathが渡された場合（将来の別経路・テスト用）は
  // そのまま即時公開として組み立てる。
  const hasCover = Boolean(input.coverRelativePath);

  const sourcesYaml = input.items
    .map((item) => {
      const lines = [`  - name: ${yamlString(item.sourceName)}`, `    url: ${yamlString(item.sourceUrl)}`];
      if (item.sourcePublishedDate) lines.push(`    publishedDate: ${yamlString(item.sourcePublishedDate)}`);
      lines.push(`    accessedDate: ${input.date}`);
      return lines.join("\n");
    })
    .join("\n");

  const frontmatter = [
    "---",
    `title: ${yamlString(input.title)}`,
    `description: ${yamlString(input.description)}`,
    `publishedAt: ${input.publishedAtIso}`,
    `edition: ${input.edition}`,
    hasCover ? `cover: ${yamlString(input.coverRelativePath)}` : null,
    "topics:",
    ...topics.map((t) => `  - ${t}`),
    input.summary ? `summary: ${yamlString(input.summary)}` : null,
    `sourceCount: ${input.items.length}`,
    `draft: false`,
    "sources:",
    sourcesYaml,
    "---",
  ]
    .filter((line) => line !== null)
    .join("\n");

  const body = input.items
    .map((item) => `## ${item.heading}\n\n${item.body}\n\n出典: [${item.sourceName}](${item.sourceUrl})`)
    .join("\n\n");

  return `${frontmatter}\n\n${body}\n`;
}

export function newsSlug(date, edition) {
  return `${date}-${edition}`;
}

export function newsFilePath(date, edition) {
  return `src/content/news/${newsSlug(date, edition)}.md`;
}
