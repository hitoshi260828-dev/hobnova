#!/usr/bin/env node
// HOBNOVA記事完成 LINE通知。
//
// 既存のClaude Code用LINE通知（Notification/PreToolUse hook、notify.mjs、
// reset-state.mjs）とは完全に独立しており、それらの挙動には一切影響しない。
// このスクリプトは記事制作フロー（PR作成後）の最後に、AIが明示的に実行する。
//
// 使い方:
//   node scripts/notify-article-ready.mjs \
//     --pr 12 \
//     --title "記事タイトル" \
//     --summary "記事の概要（1〜2文）" \
//     [--preview-url "https://..."]   # 省略時はPRコメントから自動解決
//     [--dry-run]                      # LINEへは送らず、内容をconsoleに出力するのみ
//     [--checks-timeout-ms 300000]
//     [--preview-timeout-ms 180000]
//
// 引数の代わりに環境変数 ARTICLE_TITLE / ARTICLE_SUMMARY / PR_NUMBER / PREVIEW_URL
// でも指定できる（GitHub ActionsのCI環境からの呼び出しを想定）。
//
// 通知条件（すべて満たした場合のみLINE送信。CI失敗時は送信しない）:
//   1. 指定PRのstatus checkがすべて成功
//   2. Preview URLの解決に成功（失敗時もfallback URLで継続、無限待機はしない）
import { waitForPrChecks, resolvePreviewUrl } from "./lib/github-pr.mjs";
import { sendLinePush } from "./lib/line-push.mjs";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    if (key === "dry-run") {
      args.dryRun = true;
      continue;
    }
    args[key] = argv[i + 1];
    i++;
  }
  return args;
}

function buildMessage({ title, summary, previewUrl, prUrl }) {
  return (
    "🤖 HOBNOVA AI Agent\n\n" +
    "新しい記事が完成しました。\n\n" +
    `📄 ${title}\n\n` +
    `📝 ${summary}\n\n` +
    "👀 Preview\n" +
    `${previewUrl}\n\n` +
    "🔀 GitHub PR\n" +
    `${prUrl}\n\n` +
    "✅ 内容を確認し、問題なければGitHubでMergeしてください。\n" +
    "本番公開は人間によるMerge後に行われます。"
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const title = args.title ?? process.env.ARTICLE_TITLE;
  const summary = args.summary ?? process.env.ARTICLE_SUMMARY;
  const prNumber = args.pr ?? process.env.PR_NUMBER;
  const previewUrlOverride = args["preview-url"] ?? process.env.PREVIEW_URL;
  const dryRun = Boolean(args.dryRun) || process.env.DRY_RUN === "1";
  const checksTimeoutMs = Number(args["checks-timeout-ms"] ?? 5 * 60 * 1000);
  const previewTimeoutMs = Number(args["preview-timeout-ms"] ?? 3 * 60 * 1000);

  if (!title || !summary || !prNumber) {
    console.error(
      "使い方: node scripts/notify-article-ready.mjs --pr <番号> --title <タイトル> --summary <概要> [--preview-url <URL>] [--dry-run]"
    );
    process.exitCode = 1;
    return;
  }

  console.log(`[notify-article-ready] PR #${prNumber} のstatus checkを確認中...`);
  const checkResult = await waitForPrChecks(prNumber, {
    timeoutMs: checksTimeoutMs,
    onPoll: (checks) => {
      const summaryLine = checks.map((c) => `${c.name}=${c.status}/${c.conclusion ?? "-"}`).join(", ");
      console.log(`[notify-article-ready]   checks: ${summaryLine || "(まだ報告なし)"}`);
    },
  });

  if (checkResult.timedOut) {
    console.error(`[notify-article-ready] タイムアウト: ${checksTimeoutMs}ms以内にstatus checkが完了しませんでした。通知は送信しません。`);
    process.exitCode = 1;
    return;
  }

  if (!checkResult.ok) {
    const failedNames = checkResult.failed.map((c) => `${c.name}(${c.conclusion})`).join(", ");
    console.error(`[notify-article-ready] status checkが失敗しています: ${failedNames}。通知は送信しません。`);
    process.exitCode = 1;
    return;
  }

  console.log("[notify-article-ready] status check成功。Preview URLを解決中...");

  let previewUrl = previewUrlOverride;
  let previewSource = "arg-or-env-override";
  if (!previewUrl) {
    const resolved = await resolvePreviewUrl(prNumber, checkResult.headRefName, { timeoutMs: previewTimeoutMs });
    previewUrl = resolved.url;
    previewSource = resolved.source;
  }
  console.log(`[notify-article-ready] Preview URL: ${previewUrl} (source=${previewSource})`);

  const message = buildMessage({ title, summary, previewUrl, prUrl: checkResult.prUrl });

  if (dryRun) {
    console.log("\n[notify-article-ready] --dry-run のためLINEへは送信しません。送信予定のメッセージ:\n");
    console.log("----------------------------------------");
    console.log(message);
    console.log("----------------------------------------");
    return;
  }

  console.log("[notify-article-ready] LINEへ送信します...");
  await sendLinePush(message);
  console.log("[notify-article-ready] 送信完了。");
}

main().catch((err) => {
  console.error(`[notify-article-ready] エラー: ${err.message}`);
  process.exitCode = 1;
});
