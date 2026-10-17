// ニュース収集+要約生成。OpenAI Responses API（web_searchツール）を1回呼び出し、
// 「情報収集」と「記事執筆」を1コールにまとめる（コスト・一貫性の両面で分割より有利）。
//
// 重要な注意: このファイルの実API呼び出しは、このセッション内では一度も実行（＝課金）して
// いない。構造体・プロンプトは公開ドキュメントのパターンに沿って実装したが、Responses API
// の正確な挙動（web_searchとjson出力の組み合わせの安定性等）は未検証。実運用前に
// DRY_RUN無しで最低1回、人間の確認付きで試すことを強く推奨する。
import OpenAI from "openai";
import { NEWS_TOPIC_IDS, NEWS_TOPIC_LABELS } from "./topics.mjs";

export const DEFAULT_NEWS_TEXT_MODEL = "gpt-4.1";

export function resolveNewsTextModel(env = process.env) {
  return env.NEWS_TEXT_MODEL?.trim() || DEFAULT_NEWS_TEXT_MODEL;
}

const EDITION_FRAMING = {
  morning: {
    label: "朝版",
    angle: "「今日知っておきたいニュース」。今日1日を過ごす上で押さえておくと役立つ、直近12〜18時間以内の動き。",
  },
  evening: {
    label: "夜版",
    angle: "「今日動いたニュースと、その意味」。今日1日で実際に動いた出来事とその影響・意味合い。直近8〜12時間以内の動き。",
  },
};

function buildPrompt({ edition, date, excludeUrls }) {
  const framing = EDITION_FRAMING[edition];
  const topicList = NEWS_TOPIC_IDS.map((id) => `${id}（${NEWS_TOPIC_LABELS[id]}）`).join(" / ");

  const excludeNote =
    excludeUrls.length > 0
      ? `\n以下のURLは直近の朝版/夜版で既に取り上げ済みのため、同じニュースの再掲は避けてください:\n${excludeUrls.map((u) => `- ${u}`).join("\n")}`
      : "";

  return `あなたはHOBNOVAという個人メディアのニュース編集者です。HOBNOVAはキャンプ・ガジェット・データ分析・デジタルマーケティングなど「大人の好奇心」を扱う個人メディアで、読者は技術・ガジェット・投資/お金・働き方に関心のある大人です。

対象日: ${date}（JST）
版: ${framing.label}（${framing.angle}）
対象トピック: ${topicList}

以下の条件でニュースを3〜6件選び、記事を作成してください。

【情報源の条件】
- 一次情報（公式発表・公式ブログ・企業IR・公的機関の発表）を優先する
- 可能な限り確認可能な公開日のある情報源を使う
- 出所不明な噂・未確認情報は含めない
- 同一内容の重複ニュースは1件にまとめる
${excludeNote}

【各ニュース項目について書くこと】
1. 何が起きたか（事実を簡潔に）
2. なぜ重要か
3. HOBNOVA読者（技術・ガジェット・投資/お金・働き方に関心がある大人）にどう関係するか
4. 出典（情報源名・URL・可能なら公開日）

【著作権上の注意】
- 元記事の文章を長文でそのまま引用・転載しない。必ず自分の言葉で要約する
- 各項目は150〜300字程度の日本語要約とする
- 出典のURL・情報源名は正確に保持する

【文章のトーン】
- 「です・ます」調の単調な連続を避け、自然な日本語にする
- 体言止め・短文・温度感のある表現を適度に使う
- SEOキーワードの羅列、AIが書いたと一目でわかる機械的な表現を避ける
- 実際に確認していない体験・感想は書かない（捏造しない）

出力は以下のJSON形式のみを返してください（前後に説明文やMarkdownのコードフェンスを付けない、JSON以外の文字を含めない）:

{
  "title": "記事タイトル（日本語、30〜50字程度）",
  "description": "記事の要約（60〜120字程度）",
  "summary": "記事全体の一言まとめ（40〜80字程度、省略可）",
  "topics": ["対象トピックIDの配列（上記トピックリストのIDのみ、1〜4個）"],
  "items": [
    {
      "heading": "ニュース項目の見出し（20〜40字程度）",
      "body": "本文（150〜300字程度、何が起きたか・なぜ重要か・HOBNOVA読者への関係を含む）",
      "sourceName": "情報源名",
      "sourceUrl": "https://...",
      "sourcePublishedDate": "YYYY-MM-DD（分かる場合のみ、不明なら省略）"
    }
  ]
}`;
}

function extractJson(text) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  return JSON.parse(candidate);
}

function validateResearchResult(parsed) {
  if (!parsed || typeof parsed !== "object") throw new Error("research result is not an object");
  if (typeof parsed.title !== "string" || !parsed.title) throw new Error("research result missing title");
  if (typeof parsed.description !== "string" || !parsed.description) throw new Error("research result missing description");
  if (!Array.isArray(parsed.topics) || parsed.topics.length === 0) throw new Error("research result missing topics");
  const invalidTopics = parsed.topics.filter((t) => !NEWS_TOPIC_IDS.includes(t));
  if (invalidTopics.length > 0) throw new Error(`research result has invalid topic ids: ${invalidTopics.join(", ")}`);
  if (!Array.isArray(parsed.items) || parsed.items.length === 0) throw new Error("research result missing items");
  for (const item of parsed.items) {
    if (!item.heading || !item.body || !item.sourceName || !item.sourceUrl) {
      throw new Error("research result item missing required field (heading/body/sourceName/sourceUrl)");
    }
    try {
      new URL(item.sourceUrl);
    } catch {
      throw new Error(`research result item has invalid sourceUrl: ${item.sourceUrl}`);
    }
  }
  return parsed;
}

/**
 * ニュースを収集し記事内容を生成する。実際にOpenAI APIを呼び出す（課金が発生する）。
 * @param {{ edition: "morning"|"evening", date: string, excludeUrls: string[] }} options
 * @param {{ apiKey: string, model: string }} config
 */
export async function researchNews(options, config) {
  const client = new OpenAI({ apiKey: config.apiKey });
  const prompt = buildPrompt(options);

  const response = await client.responses.create({
    model: config.model,
    tools: [{ type: "web_search" }],
    input: prompt,
  });

  const text = response.output_text;
  if (!text) throw new Error("OpenAI response contained no output_text");

  const parsed = extractJson(text);
  return validateResearchResult(parsed);
}

export { buildPrompt as buildNewsResearchPrompt };
