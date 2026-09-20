// LINE Messaging API へテキストメッセージをpushする最小限のヘルパー。
//
// 設計意図:
// - HOBNOVAリポジトリ内で完結させる（追加npmパッケージ不要、fetchのみ使用）。
//   claude-line-notifier/lib/line.mjs と同じ実装パターンだが、あえて別ファイルとして
//   複製している。claude-line-notifier はHOBNOVAとは別のGitリポジトリ（ローカルの
//   sibling フォルダ）であり、GitHub Actions等のクラウド環境ではチェックアウトされない
//   ため、そこへ直接importする構成は将来ポータブルにならない。
// - 秘密情報はGitHub Actions Secretsからprocess.envへ渡す。ローカルファイルは読まない。

const LINE_PUSH_ENDPOINT = "https://api.line.me/v2/bot/message/push";

export const lineConfig = {
  get channelAccessToken() {
    return process.env.LINE_CHANNEL_ACCESS_TOKEN ?? "";
  },
  get lineUserId() {
    return process.env.LINE_USER_ID ?? "";
  },
};

export function isLineConfigured() {
  return Boolean(lineConfig.channelAccessToken && lineConfig.lineUserId);
}

export function assertLineConfigured() {
  const missing = [];
  if (!lineConfig.channelAccessToken) missing.push("LINE_CHANNEL_ACCESS_TOKEN");
  if (!lineConfig.lineUserId) missing.push("LINE_USER_ID");
  if (missing.length > 0) {
    throw new Error(
      `LINE通知に必要な環境変数が未設定です: ${missing.join(", ")}\n` +
        `GitHub Actions Secretsを確認してください。`
    );
  }
}

/**
 * LINE Messaging API の push message でテキストを送信する。
 * @param {string} text
 */
export async function sendLinePush(text) {
  assertLineConfigured();

  const res = await fetch(LINE_PUSH_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${lineConfig.channelAccessToken}`,
    },
    body: JSON.stringify({
      to: lineConfig.lineUserId,
      messages: [{ type: "text", text }],
    }),
  });

  if (!res.ok) {
    // APIレスポンスに秘密情報や宛先由来の情報が含まれる可能性があるため本文はログへ出さない。
    throw new Error(`LINE push failed: ${res.status} ${res.statusText}`);
  }
}
