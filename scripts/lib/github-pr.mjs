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

/** PRのURLだけを取得する（Preview検出に失敗した場合のフォールバック通知用）。 */
export async function getPrUrl(prNumber) {
  const data = await getPrView(prNumber);
  return data.url;
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
export async function waitForCloudflarePreview(prNumber, headSha, { timeoutMs = 20 * 60 * 1000, pollIntervalMs = 10000 } = {}) {
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
      // 2026-10-09、PR #57でこの条件がthrowになっていたため通知自体が完全に失われ、
      // CI green・マージ可能な記事PRが8日間気づかれず放置された実績がある。
      // 呼び出し元がフォールバック通知を送れるよう、例外ではなく結果として返す。
      return { timedOut: true, prUrl: data.url };
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

// --- 日次公開チェック（daily-publish-check.mjs）向けヘルパー ---

/**
 * src/content/ 配下を変更しているopen・非draftのPRを、作成日の古い順で返す
 * （長く放置されているPRから先に確認するため）。画像のみのPR（cover/inline追加PR）は
 * 除外しない——既存記事へのcover追加もここでは「公開対象の変更」として扱う。
 */
export async function listOpenContentPRs() {
  const prs = await ghJson([
    "pr", "list", "--state", "open", "--json",
    "number,title,createdAt,isDraft,headRefName,files",
    "--limit", "100",
  ]);
  return (prs ?? [])
    .filter((pr) => !pr.isDraft)
    .filter((pr) => (pr.files ?? []).some((f) => CONTENT_PATH.test(f.path)))
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
}

/** PRがCI green・Cloudflare Pages green・クリーンにマージ可能かを確認する。 */
export async function getPrMergeSafety(prNumber) {
  const data = await ghJson([
    "pr", "view", String(prNumber), "--json",
    "mergeable,mergeStateStatus,statusCheckRollup",
  ]);
  const checks = data.statusCheckRollup ?? [];
  const ciSuccess = checks.some((c) => c.name === "astro check & build" && c.conclusion === "SUCCESS");
  const cloudflareCheck = checks.find((c) => c.name === "Cloudflare Pages");
  const cloudflareSuccess = !cloudflareCheck || cloudflareCheck.conclusion === "SUCCESS";
  return {
    mergeable: data.mergeable === "MERGEABLE" && data.mergeStateStatus === "CLEAN",
    ciSuccess,
    cloudflareSuccess,
  };
}

/** squash mergeする（既存のPR運用と同じ方式、branchは削除しない）。 */
export async function squashMergePR(prNumber) {
  await execFileAsync("gh", ["pr", "merge", String(prNumber), "--squash", "--delete-branch=false"], {
    env: process.env,
    maxBuffer: 10 * 1024 * 1024,
  });
  const data = await ghJson(["pr", "view", String(prNumber), "--json", "mergeCommit,url"]);
  return { commitSha: data.mergeCommit?.oid ?? null, prUrl: data.url };
}

/**
 * 指定commit（通常はmainの最新）に対するCloudflare Pages本番デプロイの完了を待つ。
 * PR Previewとは別の、mainへのpush後に動く本番デプロイのcheck-runを見る。
 */
export async function waitForProductionDeploy(sha, { timeoutMs = 10 * 60 * 1000, pollIntervalMs = 10000 } = {}) {
  const start = Date.now();
  while (true) {
    const data = await ghJson(["api", `repos/{owner}/{repo}/commits/${sha}/check-runs`]);
    const cloudflare = (data.check_runs ?? []).find((c) => c.name === "Cloudflare Pages");
    if (cloudflare?.status === "completed") {
      return { completed: true, success: cloudflare.conclusion === "success" };
    }
    if (Date.now() - start >= timeoutMs) {
      return { completed: false, success: false };
    }
    await sleep(pollIntervalMs);
  }
}
