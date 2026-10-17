// NEWS用アイキャッチ生成。scripts/lib/image-pipeline/openai-cover.ts と同じ呼び出し方だが、
// news-publish.mjsはプレーンNode（tsx不使用）で動くためTSモジュールを直接importできず、
// 同じロジックをここに複製している（openai-cover.ts側を変更しても自動では追随しない点に注意）。
import OpenAI from "openai";

export const DEFAULT_NEWS_IMAGE_MODEL = "gpt-image-1";

export function resolveNewsImageModel(env = process.env) {
  return env.NEWS_IMAGE_MODEL?.trim() || DEFAULT_NEWS_IMAGE_MODEL;
}

function buildCoverPrompt({ title, description, edition }) {
  const editionJa = edition === "morning" ? "朝" : "夜";
  return `HOBNOVAというニュースメディアの${editionJa}版アイキャッチ画像。写実的な編集写真風、文字なし。テーマ: ${title}。${description}。ニュース・情報・テクノロジーを連想させる抽象的または象徴的な構図（新聞・画面・データの流れ・都市の${edition === "morning" ? "朝" : "夜"}景など）。文字・ロゴ・架空のUI・ウォーターマークは一切含めない。`;
}

/**
 * NEWSアイキャッチを1枚生成する。実際にOpenAI APIを呼び出す（課金が発生する）。
 * @param {{ title: string, description: string, edition: "morning"|"evening" }} input
 * @param {{ apiKey: string, model: string }} config
 */
export async function generateNewsCover(input, config) {
  const client = new OpenAI({ apiKey: config.apiKey });
  const prompt = buildCoverPrompt(input);

  const response = await client.images.generate({
    model: config.model,
    prompt,
    size: "1536x1024",
    n: 1,
  });

  const b64 = response.data?.[0]?.b64_json;
  if (!b64) throw new Error("OpenAI Image API returned no image data (b64_json missing)");

  return { buffer: Buffer.from(b64, "base64"), ext: "png" };
}

export { buildCoverPrompt as buildNewsCoverPrompt };
