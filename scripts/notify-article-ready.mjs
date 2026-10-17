#!/usr/bin/env node
// astro check & build成功後のworkflow_runから呼び出す記事完成通知。
import {
  claimNotification,
  completeNotification,
  getChangedArticle,
  releaseNotification,
  waitForCloudflarePreview,
} from "./lib/github-pr.mjs";
import { isLineConfigured, sendLinePush } from "./lib/line-push.mjs";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, "");
    if (key === "dry-run" || key === "skip-github") args[key] = true;
    else args[key] = argv[++i];
  }
  return args;
}

export function buildMessage({ title, summary, previewUrl, prUrl }) {
  return `🤖 HOBNOVA AI Agent\n\n新しい記事が完成しました。\n\n📄 ${title}\n\n📝 ${summary}\n\n👀 Preview\n${previewUrl}\n\n🔀 GitHub PR\n${prUrl}\n\n✅ 内容を確認し、問題なければGitHubでMergeしてください。\n本番公開は人間によるMerge後に行われます。`;
}

// Cloudflare Pages Previewのコメントを検出できなかった場合でも、CI自体は成功しているため
// 「何も知らされない」よりはプレビューURL抜きで通知する方が安全（2026-10-09、PR #57で
// このtimeoutにより通知が完全に失われ、CI green・マージ可能な記事PRが8日間放置された実績あり）。
export function buildFallbackMessage({ title, summary, prUrl, reason }) {
  return `🤖 HOBNOVA AI Agent\n\n新しい記事のCIは成功しましたが、Preview確認がタイムアウトしました。\n\n📄 ${title}\n\n📝 ${summary}\n\n🔀 GitHub PR\n${prUrl}\n\n⚠️ ${reason}\nPreview URLはPRページのCloudflare Pagesコメントから直接確認してください。\n✅ 内容を確認し、問題なければGitHubでMergeしてください。`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dryRun = args["dry-run"] || process.env.DRY_RUN === "1";
  const skipGithub = args["skip-github"];
  const prNumber = args.pr ?? process.env.PR_NUMBER;
  const headSha = args["head-sha"] ?? process.env.HEAD_SHA;
  if (!prNumber || !headSha) throw new Error("PR_NUMBERとHEAD_SHAが必要です。");
  if (skipGithub && !dryRun) throw new Error("--skip-githubは--dry-runと同時にだけ使用できます。");
  if (!dryRun && !isLineConfigured()) {
    console.log("[notify-article-ready] LINE用GitHub Secretsが未設定のため通知をスキップします。");
    return;
  }

  let title = args.title;
  let summary = args.summary;
  let previewUrl = args["preview-url"];
  let prUrl = args["pr-url"];

  let isFallback = false;

  if (!skipGithub) {
    const article = await getChangedArticle(prNumber, headSha);
    if (!article) {
      console.log("[notify-article-ready] 対象の記事ファイル変更がないため通知しません。");
      return;
    }
    ({ title, summary } = article);
    console.log(`[notify-article-ready] 対象コンテンツ: ${article.path}`);
    const preview = await waitForCloudflarePreview(prNumber, headSha, {
      timeoutMs: Number(args["preview-timeout-ms"] ?? process.env.PREVIEW_TIMEOUT_MS ?? 20 * 60 * 1000),
    });
    if (preview.stale) {
      console.log("[notify-article-ready] PRに新しいcommitがあるため古い通知をスキップします。");
      return;
    }
    if (preview.timedOut) {
      // Preview検出に失敗してもCI自体はこの時点で成功済みのため、通知自体を失わない
      // （詳細は buildFallbackMessage のコメント参照）。previewUrlは空のまま進める。
      console.warn("[notify-article-ready] Preview検出がタイムアウトしました。フォールバック通知を送信します。");
      isFallback = true;
      prUrl = preview.prUrl;
    } else {
      ({ previewUrl, prUrl } = preview);
    }
  }

  if (!title || !summary || !prUrl || (!isFallback && !previewUrl)) {
    throw new Error("通知内容を解決できませんでした。");
  }
  const message = isFallback
    ? buildFallbackMessage({ title, summary, prUrl, reason: "Cloudflare Pagesのデプロイコメントを検出できませんでした。" })
    : buildMessage({ title, summary, previewUrl, prUrl });
  if (dryRun) {
    console.log("[notify-article-ready] dry-run: LINE APIは呼び出しません。\n");
    console.log(message);
    return;
  }

  const claim = await claimNotification(prNumber, headSha);
  if (!claim.claimed) {
    console.log(`[notify-article-ready] このcommitは既に${claim.state}です。通知しません。`);
    return;
  }
  try {
    await sendLinePush(message);
  } catch (error) {
    await releaseNotification(claim.commentId).catch(() => {});
    throw error;
  }

  try {
    await completeNotification(claim.commentId, headSha);
  } catch {
    // LINE送信後はclaimを残す。ここで削除すると再実行時に二重送信となるため。
    console.warn("[notify-article-ready] LINE送信済みですがPRコメントを更新できませんでした。claimは保持します。");
  }
  console.log("[notify-article-ready] LINE通知を送信しました。");
}

main().catch((error) => {
  // Token/User IDやLINEレスポンス本文は出力しない。
  console.error(`[notify-article-ready] ${error.message}`);
  process.exitCode = 1;
});
