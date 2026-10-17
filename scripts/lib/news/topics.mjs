// src/consts.ts の NEWS_TOPIC_IDS と同じ値を持つ。scripts/配下はプレーンNode（tsx不使用）で
// 動くためsrc/配下のTypeScriptを直接importできず、この小さな固定配列だけ複製している
// （functions/ 層がsrc/を直接importしないのと同じ、本リポジトリの既存の実行コンテキスト分離）。
export const NEWS_TOPIC_IDS = [
  "ai",
  "generative-ai",
  "development",
  "tech",
  "investment",
  "money",
  "work",
  "web-media",
  "lifestyle",
  "policy",
];

export const NEWS_TOPIC_LABELS = {
  ai: "AI",
  "generative-ai": "生成AI",
  development: "開発",
  tech: "テック",
  investment: "投資",
  money: "お金",
  work: "仕事・働き方",
  "web-media": "Webメディア",
  lifestyle: "生活",
  policy: "制度変更",
};
