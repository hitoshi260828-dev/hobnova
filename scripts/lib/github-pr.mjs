// GitHub PRとCloudflare Pages Previewを扱うヘルパー。
// GitHub Actionsに標準搭載されるghを使い、認証情報を独自に保持しない。
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const CONTENT_PATH = /^src\/content\/(articles|data-lab|tools)\/.+\.(md|mdx)$/;
const NOTIFICATION_MARKER = "hobnova-line-notification";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function ghJson(args, input) {
  const { stdout } = await execFileAsync("gh", args, {
    input,
    env: process.env,
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout.trim() ? JSON.parse(stdout) : null;
}

async function getPrView(prNumber) {
  return ghJson(["pr", "view", String(prNumber), "--json", "url,headRefOid,comments,title,body"]);
}

function marker(headSha, state) {
  return `<!-- ${NOTIFICATION_MARKER}:${headSha}:${state} -->`;
}

function parseFrontmatter(source) {
  const block = source.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!block) return {};
  const value = (name) => {
    const match = block[1].match(new RegExp(`^${name}:\\s*(.+?)\\s*$`, "m"));
    if (!match) return null;
    const raw = match[1].trim();
    if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
      return raw.slice(1, -1).replace(/\\([\\"'])/g, "$1");
    }
    return raw;
  };
  return { title: value("title"), summary: value("description") };
}

async function getFileAtRef(path, ref) {
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  const data = await ghJson(["api", `repos/{owner}/{repo}/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`]);
  return Buffer.from(data.content, "base64").toString("utf8");
}

/** PRで追加・更新された記事を1件取得する。記事以外、削除のみ、画像のみのPRはnull。 */
export async function getChangedArticle(prNumber, headSha) {
  const pages = await ghJson(["api", "--paginate", "--slurp", `repos/{owner}/{repo}/pulls/${prNumber}/files?per_page=100`]);
  const files = pages.flat();
  const article = files.find((file) => file.status !== "removed" && CONTENT_PATH.test(file.filename));
  if (!article) return null;
  const metadata = parseFrontmatter(await getFileAtRef(article.filename, headSha));
  if (!metadata.title || !metadata.summary) {
    throw new Error(`${article.filename} のtitleまたはdescriptionを取得できません。`);
  }
  return { ...metadata, path: article.filename };
}

/**
 * Cloudflare botの実際のPRコメント形式を使う。現在のhead SHA、Deploy successful、
 * Preview URLの3つが同じコメントに揃うまで待つため、古いPreviewを通知しない。
 */
export async function waitForCloudflarePreview(prNumber, headSha, { timeoutMs = 10 * 60 * 1000, pollIntervalMs = 10000 } = {}) {
  const start = Date.now();
  while (true) {
    const data = await getPrView(prNumber);
    if (data.headRefOid !== headSha) return { stale: true };
    const shortSha = headSha.slice(0, 7);
    for (const comment of data.comments ?? []) {
      const body = comment.body ?? "";
      const isCloudflare = comment.author?.login?.startsWith("cloudflare-workers-and-pages") || /Cloudflare Pages/i.test(body);
      const deployedSha = body.match(/Latest commit:<\/strong>\s*<\/td><td>\s*<code>([0-9a-f]+)<\/code>/i)?.[1];
      const previewUrl = body.match(/Preview URL:<\/strong><\/td><td>\s*<a href=['"](https:\/\/[^'"]+)['"]/i)?.[1];
      if (isCloudflare && deployedSha === shortSha && /Deploy successful!/i.test(body) && previewUrl) {
        return { previewUrl, prUrl: data.url };
      }
    }
    if (Date.now() - start >= timeoutMs) {
      throw new Error(`Cloudflare Pages Previewが${timeoutMs}ms以内に成功しませんでした。`);
    }
    await sleep(pollIntervalMs);
  }
}

/** SHA単位のclaimコメントを作り、同じcommitへの二重送信を防ぐ。 */
export async function claimNotification(prNumber, headSha) {
  const data = await getPrView(prNumber);
  // 待機中に新しいcommitがpushされた場合、古いPreviewの通知は送らない。
  if (data.headRefOid !== headSha) return { claimed: false, state: "stale" };
  const existing = (data.comments ?? []).find((comment) => (comment.body ?? "").includes(`${NOTIFICATION_MARKER}:${headSha}:`));
  if (existing) return { claimed: false, state: existing.body.includes(":sent -->") ? "sent" : "claimed" };

  const comment = await ghJson([
    "api", `repos/{owner}/{repo}/issues/${prNumber}/comments`, "--method", "POST",
    "-f", `body=${marker(headSha, "claimed")}\nLINE通知を準備しています。`,
  ]);
  return { claimed: true, commentId: comment.id };
}

export async function completeNotification(commentId, headSha) {
  await ghJson([
    "api", `repos/{owner}/{repo}/issues/comments/${commentId}`, "--method", "PATCH",
    "-f", `body=${marker(headSha, "sent")}\nこのcommitの記事完成通知をLINEへ送信しました。`,
  ]);
}

export async function releaseNotification(commentId) {
  await ghJson(["api", `repos/{owner}/{repo}/issues/comments/${commentId}`, "--method", "DELETE"]);
}
