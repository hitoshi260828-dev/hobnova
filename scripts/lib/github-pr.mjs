// GitHub PRのstatus check待機とCloudflare Pages Preview URL解決。
//
// GitHub CLI (`gh`) をサブプロセスとして呼び出す方式を採用している。理由:
// - ローカルでは既にキーリング認証済みの gh をそのまま使える（追加のトークン管理不要）
// - GitHub Actions のランナーには gh がプリインストールされており、GITHUB_TOKEN を
//   自動的に拾って認証するため、このモジュールはコード変更なしでCI上でも動く
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ghJson(args) {
  const { stdout } = await execFileAsync("gh", args, { maxBuffer: 10 * 1024 * 1024 });
  return JSON.parse(stdout);
}

/**
 * PRのstatus check rollup（GitHub Actions・Cloudflare Pages等すべて）を取得する。
 */
async function getPrView(prNumber) {
  return ghJson(["pr", "view", String(prNumber), "--json", "statusCheckRollup,url,headRefName,comments"]);
}

/**
 * すべてのstatus checkが完了するまでポーリングし、成功/失敗/timeoutを返す。
 * 無限ループにならないよう timeoutMs で必ず打ち切る。
 */
export async function waitForPrChecks(prNumber, { timeoutMs = 5 * 60 * 1000, pollIntervalMs = 10000, onPoll } = {}) {
  const start = Date.now();

  while (true) {
    const data = await getPrView(prNumber);
    const checks = data.statusCheckRollup ?? [];
    if (onPoll) onPoll(checks);

    const hasChecks = checks.length > 0;
    const allCompleted = hasChecks && checks.every((c) => (c.status ?? "COMPLETED") === "COMPLETED");

    if (allCompleted) {
      const failed = checks.filter((c) => c.conclusion && !["SUCCESS", "NEUTRAL", "SKIPPED"].includes(c.conclusion));
      return { ok: failed.length === 0, timedOut: false, checks, failed, prUrl: data.url, headRefName: data.headRefName };
    }

    if (Date.now() - start > timeoutMs) {
      return { ok: false, timedOut: true, checks, failed: [], prUrl: data.url, headRefName: data.headRefName };
    }

    await sleep(pollIntervalMs);
  }
}

function sanitizeBranchForPreviewUrl(branchName) {
  return branchName
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Cloudflare PagesのボットがPRへ投稿するコメントから Preview URL を抽出する。
 * 優先順位: PR固有のPreview URL（コミットハッシュ単位） > Branch Preview URL
 */
function extractCloudflarePreviewUrls(commentBody) {
  const previewMatch = commentBody.match(/Preview URL:<\/strong><\/td><td>\s*<a href='([^']+)'/i);
  const branchMatch = commentBody.match(/Branch Preview URL:<\/strong><\/td><td>\s*<a href='([^']+)'/i);
  return {
    previewUrl: previewMatch?.[1] ?? null,
    branchPreviewUrl: branchMatch?.[1] ?? null,
  };
}

/**
 * Preview URLを解決する。timeoutMs以内にCloudflareのコメントが見つからない場合は、
 * ブランチ名から決定論的に導出したBranch Preview URLをfallbackとして返す
 * （実際のデプロイが遅れて404になる可能性はあるが、無限待機は避ける）。
 */
export async function resolvePreviewUrl(prNumber, headRefName, { timeoutMs = 3 * 60 * 1000, pollIntervalMs = 10000, projectName = "hobnova" } = {}) {
  const start = Date.now();

  while (true) {
    const data = await getPrView(prNumber);
    const comments = data.comments ?? [];
    const cfComment = comments.find(
      (c) => c.author?.login === "cloudflare-workers-and-pages" || /Cloudflare Pages/i.test(c.body ?? "")
    );

    if (cfComment) {
      const { previewUrl, branchPreviewUrl } = extractCloudflarePreviewUrls(cfComment.body ?? "");
      if (previewUrl || branchPreviewUrl) {
        return {
          url: previewUrl ?? branchPreviewUrl,
          source: previewUrl ? "pr-comment-preview-url" : "pr-comment-branch-url",
        };
      }
    }

    if (Date.now() - start > timeoutMs) {
      const branch = headRefName ?? data.headRefName;
      return {
        url: `https://${sanitizeBranchForPreviewUrl(branch)}.${projectName}.pages.dev`,
        source: "fallback-computed-branch-url",
      };
    }

    await sleep(pollIntervalMs);
  }
}
