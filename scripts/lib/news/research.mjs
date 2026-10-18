// ニュース収集+要約生成。OpenAI Responses API（web_searchツール）を1回呼び出し、
// 「情報収集」と「記事執筆」を1コールにまとめる（コスト・一貫性の両面で分割より有利）。
//
// 実機確認済み（2026-10-17、news-morning.yml/news-evening.ymlのworkflow_dispatch、
// dry_run=false、PR #62/#63）: research 1回あたり実際にOpenAI APIを呼び出し課金が発生し、
// web_searchとJSON出力の組み合わせは安定して動作することを確認済み。
import OpenAI from "openai";
import dns from "node:dns/promises";
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

// web_searchで取得した外部コンテンツ（＝信頼できない入力）がそのままcommit・本番公開される
// ため、構造チェックに加えてコンテンツ自体の安全性もここで検証する。HTMLタグを含む出力は
// 丸ごと拒否する（astro.config.mjsにMarkdown内生HTMLのsanitize設定が無いため、素通しで
// 本番へ出てしまう。web_search結果へのprompt injectionで<script>等が混入するのを防ぐ）。
const HTML_TAG_PATTERN = /<\/?[a-zA-Z][^>]*>/;
const MAX_LENGTHS = { title: 80, description: 160, summary: 120, heading: 60, body: 400 };

function assertPlainText(value, field, maxLength) {
  if (HTML_TAG_PATTERN.test(value)) {
    throw new Error(`research result field "${field}" contains HTML-like markup, rejecting: ${value.slice(0, 80)}`);
  }
  if (value.length > maxLength) {
    throw new Error(`research result field "${field}" exceeds ${maxLength} chars (copyright/verbatim-quote guard): ${value.length}`);
  }
}

function validateResearchResult(parsed) {
  if (!parsed || typeof parsed !== "object") throw new Error("research result is not an object");
  if (typeof parsed.title !== "string" || !parsed.title) throw new Error("research result missing title");
  if (typeof parsed.description !== "string" || !parsed.description) throw new Error("research result missing description");
  assertPlainText(parsed.title, "title", MAX_LENGTHS.title);
  assertPlainText(parsed.description, "description", MAX_LENGTHS.description);
  if (parsed.summary) assertPlainText(parsed.summary, "summary", MAX_LENGTHS.summary);
  if (!Array.isArray(parsed.topics) || parsed.topics.length === 0) throw new Error("research result missing topics");
  const invalidTopics = parsed.topics.filter((t) => !NEWS_TOPIC_IDS.includes(t));
  if (invalidTopics.length > 0) throw new Error(`research result has invalid topic ids: ${invalidTopics.join(", ")}`);
  if (!Array.isArray(parsed.items) || parsed.items.length === 0) throw new Error("research result missing items");
  for (const item of parsed.items) {
    if (!item.heading || !item.body || !item.sourceName || !item.sourceUrl) {
      throw new Error("research result item missing required field (heading/body/sourceName/sourceUrl)");
    }
    assertPlainText(item.heading, "items[].heading", MAX_LENGTHS.heading);
    assertPlainText(item.body, "items[].body", MAX_LENGTHS.body);
    assertPlainText(item.sourceName, "items[].sourceName", MAX_LENGTHS.title);
    try {
      new URL(item.sourceUrl);
    } catch {
      throw new Error(`research result item has invalid sourceUrl: ${item.sourceUrl}`);
    }
    if (item.sourcePublishedDate && !/^\d{4}-\d{2}-\d{2}$/.test(item.sourcePublishedDate)) {
      throw new Error(`research result item has invalid sourcePublishedDate (expected YYYY-MM-DD): ${item.sourcePublishedDate}`);
    }
  }
  return parsed;
}

// IPv4の予約・プライベートアドレス範囲（RFC1918のプライベート網、loopback、link-local/
// クラウドmetadataエンドポイント(169.254.0.0/16。AWS/GCP/Azureの169.254.169.254を含む)、
// 0.0.0.0/8）。DNS rebinding対策として、ホスト名の文字列一致ではなく実際に解決したIPで
// 判定する。
function isPrivateOrReservedIpv4(octets) {
  const [a, b] = octets;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true; // link-local / cloud metadata
  return false;
}

function isPrivateOrReservedIp(address, family) {
  if (family === 4) {
    const octets = address.split(".").map(Number);
    if (octets.length !== 4 || octets.some((n) => Number.isNaN(n))) return true; // 不正な形式は安全側に拒否
    return isPrivateOrReservedIpv4(octets);
  }
  // IPv6: loopback(::1)、unique local(fc00::/7)、link-local(fe80::/10)、
  // IPv4-mapped(::ffff:a.b.c.d)はIPv4側の範囲で再判定する。
  const normalized = address.toLowerCase();
  if (normalized === "::1") return true;
  if (/^f[c-d][0-9a-f]{2}:/.test(normalized)) return true; // fc00::/7
  if (/^fe[8-9a-b][0-9a-f]:/.test(normalized)) return true; // fe80::/10
  const v4Mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalized);
  if (v4Mapped) return isPrivateOrReservedIpv4(v4Mapped[1].split(".").map(Number));
  return false;
}

// sourceUrlが実在するホストへ実際に解決するかをHTTPで確認する。
// 実例（2026-10-17、PR #62の品質レビューで発見）: web_searchの結果からURLを組み立てる際、
// 本物の総務省発表（www.soumu.go.jp）のパスがIPリテラルのハルシネートされたホスト名
// （###.###.###.###.static.iijgio.jp）に紛れ込み、構文的には正しいURLだがクリックすると
// 無関係のサーバーでTLSホスト名不一致の警告が出る、という事故が実際に発生した。
// `new URL()`での構文チェックだけではこの種の不一致を検出できない。デフォルトのTLS証明書
// 検証を無効化しないfetch()は、ホスト名不一致の証明書を提示するサーバーへの接続を
// 自動的に拒否する（Node.jsの標準動作）ため、これを実URL到達性チェックとして利用する。
//
// SSRF対策（独立レビューで指摘、2026-10-17）: このチェックはGitHub Actionsランナー上で
// 実行される（Cloudflare Workersのようなプラットフォーム側fetch制限が無い）。
// item.sourceUrlはOpenAIモデルが生成した信頼できない入力のため、fetchする前に
// (1) httpsのみ許可、(2) 実際に解決したIPアドレスがプライベート/予約範囲でないことを
// DNS解決して確認する。
// 戻り値はfinalUrl（実際に解決した場合、redirectを辿った最終URL）またはnull（解決不可）。
// 元のURLで到達性を確認しても、実際に読者がクリックした先（redirect後）が別ホストだと
// 「検証したもの」と「表示されるもの」が食い違う（独立レビューで指摘）。そのためこの
// 最終URLをresearchNews側でsourceUrlの採用値として使う。
async function verifySourceUrlResolves(url, { fetchImpl = fetch, lookupImpl = dns.lookup, timeoutMs = 8000 } = {}) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;

  try {
    const addresses = await lookupImpl(parsed.hostname, { all: true, verbatim: true });
    if (addresses.length === 0) return null;
    if (addresses.some((a) => isPrivateOrReservedIp(a.address, a.family))) return null;
  } catch {
    // DNS解決に失敗したホストは「解決できないURL」として扱う。
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { method: "HEAD", redirect: "follow", signal: controller.signal });
    if (res.ok || (res.status >= 300 && res.status < 400)) return res.url || url;
    // HEADを拒否するサーバーは405が仕様上正しいが、実際には403/404/406/501等で拒否してくる
    // 実装もあるため、明確な成功応答で無い場合はGETで再確認する（false negativeを減らす）。
    const getRes = await fetchImpl(url, { method: "GET", redirect: "follow", signal: controller.signal });
    return getRes.ok ? getRes.url || url : null;
  } catch {
    // ネットワークエラー・TLS証明書のホスト名不一致・タイムアウト等はすべて「解決できない
    // URL」として扱う。
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * ニュースを収集し記事内容を生成する。実際にOpenAI APIを呼び出す（課金が発生する）。
 * @param {{ edition: "morning"|"evening", date: string, excludeUrls: string[] }} options
 * @param {{ apiKey: string, model: string }} config
 * @param {{ fetchImpl?: typeof fetch, lookupImpl?: typeof dns.lookup }} [httpOptions] テスト用のfetch/DNS差し替え。
 */
export async function researchNews(options, config, httpOptions = {}) {
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
  const validated = validateResearchResult(parsed);

  const checks = await Promise.all(
    validated.items.map(async (item) => ({ item, finalUrl: await verifySourceUrlResolves(item.sourceUrl, httpOptions) }))
  );
  const rejectedSources = checks.filter((c) => c.finalUrl === null).map((c) => c.item);
  // 検証に使った最終URL（redirect後）を採用する。元のsourceUrlで到達性を確認しても、
  // 実際に表示・クリックされる先がredirectで別URLになっていると食い違うため。
  validated.items = checks.filter((c) => c.finalUrl !== null).map((c) => ({ ...c.item, sourceUrl: c.finalUrl }));
  if (validated.items.length === 0) {
    throw new Error("research result: no item had a sourceUrl that actually resolves (all rejected by verifySourceUrlResolves)");
  }
  // news-publish.mjs側でのログ用（markdown組み立てには使わない）。
  validated.rejectedSources = rejectedSources;

  return validated;
}

export { buildPrompt as buildNewsResearchPrompt };
