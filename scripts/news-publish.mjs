#!/usr/bin/env node
// NEWS朝版/夜版の自動投稿パイプライン。
// 収集(OpenAI web_search) -> 重複除外 -> 記事生成 -> アイキャッチ生成 -> news collectionへ保存
// -> branch/commit/push -> PR作成 -> CI待機 -> squash merge -> 本番deploy待ち -> 本番URL確認 -> LINE通知
//
// daily-publish-check.mjs（通常記事、JST12:00、1日1本）とは完全に独立したscheduler/スクリプト。
// 対象ディレクトリ（src/content/news/）・対象PR検出方式（自分で作ったPR番号を直接扱う。
// 既存PRを検索するdaily-publish-check.mjsの方式は使わない）のどちらも重複しない設計。
//
// 重要: このスクリプトの実行（DRY_RUN無し）はOpenAI APIへの課金が必ず発生する
// （research 1回 + cover画像生成 1回）。DRY_RUNで十分に確認してから実行すること。
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

import { collectRecentSourceUrls, filterDuplicates } from "./lib/news/dedup.mjs";
import { buildNewsMarkdown, newsFilePath, newsSlug } from "./lib/news/markdown.mjs";
import { researchNews, resolveNewsTextModel } from "./lib/news/research.mjs";
import { generateNewsCover, resolveNewsImageModel } from "./lib/news/cover.mjs";
import { withRetry } from "./lib/news/retry.mjs";
import { getPrMergeSafety, squashMergePR, waitForProductionDeploy } from "./lib/github-pr.mjs";
import { isLineConfigured, sendLinePush } from "./lib/line-push.mjs";

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PRODUCTION_URL = process.env.PRODUCTION_URL ?? "https://hobnova.jp";
const CI_WAIT_TIMEOUT_MS = 10 * 60 * 1000;
const CI_POLL_INTERVAL_MS = 15000;

export function todayJst(forceDate) {
  if (forceDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(forceDate)) throw new Error(`FORCE_DATEの形式が不正です: ${forceDate}`);
    return forceDate;
  }
  const jstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return jstNow.toISOString().slice(0, 10);
}

export function publishedAtIso(date, edition) {
  // 朝版08:00 JST / 夜版20:00 JST を記事内の公開時刻として記録する（実際の投稿時刻の目安）。
  const hour = edition === "morning" ? "08:00:00" : "20:00:00";
  return `${date}T${hour}+09:00`;
}

async function git(args) {
  const { stdout } = await execFileAsync("git", args, { cwd: REPO_ROOT });
  return stdout.trim();
}

async function ghRaw(args) {
  const { stdout } = await execFileAsync("gh", args, { cwd: REPO_ROOT, maxBuffer: 10 * 1024 * 1024 });
  return stdout.trim();
}

async function notify(dryRun, text) {
  console.log(`[news-publish] 通知内容:\n${text}`);
  if (dryRun) {
    console.log("[news-publish] dry-run: LINE APIは呼び出しません。");
    return;
  }
  if (!isLineConfigured()) {
    console.log("[news-publish] LINE未設定のため通知をスキップします。");
    return;
  }
  await sendLinePush(text);
}

/**
 * このslug用のbranchに既に開いているPRがあれば返す（前回実行がCIタイムアウト等で
 * 中断し、branch/PRだけ残っている場合の再実行に対応する。無ければ毎回research/cover
 * を再実行して課金が重複し、かつgit push/gh pr createがnon-fast-forward/重複PRで
 * 失敗する）。
 */
async function findOpenPrForBranch(branch) {
  const output = await ghRaw(["pr", "list", "--head", branch, "--state", "open", "--json", "number,url", "--limit", "1"]);
  const list = JSON.parse(output || "[]");
  return list[0] ? { number: list[0].number, url: list[0].url } : null;
}

async function waitForPrCiGreen(prNumber, { timeoutMs = CI_WAIT_TIMEOUT_MS, pollIntervalMs = CI_POLL_INTERVAL_MS } = {}) {
  const start = Date.now();
  while (true) {
    const safety = await getPrMergeSafety(prNumber);
    if (safety.mergeable && safety.ciSuccess && safety.cloudflareSuccess) return { ok: true };
    if (Date.now() - start >= timeoutMs) return { ok: false, lastSafety: safety };
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}

async function main() {
  const dryRun = process.env.DRY_RUN === "true" || process.argv.includes("--dry-run");
  const skipPublish = process.env.SKIP_PUBLISH === "true" || process.argv.includes("--skip-publish");
  const forceDate = process.env.FORCE_DATE;
  const edition = process.env.EDITION;

  if (edition !== "morning" && edition !== "evening") {
    throw new Error('EDITIONは"morning"または"evening"を指定してください。');
  }

  const date = todayJst(forceDate);
  const slug = newsSlug(date, edition);
  const filePath = newsFilePath(date, edition);
  const branch = `news/${slug}`;
  const editionJa = edition === "morning" ? "朝版" : "夜版";

  console.log(`[news-publish] edition=${edition} date=${date}${dryRun ? " [DRY_RUN]" : ""}${skipPublish ? " [SKIP_PUBLISH]" : ""}`);

  // 冪等性: 同日・同editionの記事が既にmain上に存在すれば即終了する（二重投稿防止）。
  if (fs.existsSync(path.join(REPO_ROOT, filePath))) {
    console.log(`[news-publish] ${filePath} は既に存在します。本日分の${edition}版は公開済みのため終了します。`);
    return;
  }

  const recentUrls = collectRecentSourceUrls(REPO_ROOT, { today: new Date(`${date}T00:00:00Z`) });
  console.log(`[news-publish] 直近の既出source URL: ${recentUrls.size}件（重複除外対象）`);

  // 前回実行がCIタイムアウト等で中断していた場合、branch/PRが既に存在する可能性がある。
  // その場合はresearch/coverを再実行せず（課金重複防止）、既存PRのCI待ち〜mergeから再開する。
  const existingPr = await findOpenPrForBranch(branch).catch(() => null);

  if (dryRun) {
    console.log("[news-publish] 計画:");
    console.log(`  slug: ${slug}`);
    console.log(`  planned file: ${filePath}`);
    console.log(`  planned cover: src/content/news/${slug}-hero.png`);
    console.log(`  planned branch: ${branch}`);
    console.log(`  text model: ${resolveNewsTextModel()}`);
    console.log(`  image model: ${resolveNewsImageModel()}`);
    if (existingPr) {
      console.log(`  既存PRを検出: #${existingPr.number} (${existingPr.url})。実行時はresearch/coverを再生成せずこのPRを再開します。`);
    }
    console.log("[news-publish] dry-run: OpenAI APIは呼び出しません。GitHubへの書き込みも行いません。");
    return;
  }

  if (existingPr) {
    console.log(`[news-publish] ブランチ${branch}の既存PRを検出: #${existingPr.number} (${existingPr.url})。再生成せず続きから処理します。`);
    if (skipPublish) {
      await notify(
        false,
        `🤖 HOBNOVA NEWS ${editionJa}\n\n${date}分のPRは既に作成済みです（SKIP_PUBLISHのため自動マージは行っていません）。\n${existingPr.url}`
      );
      console.log("[news-publish] SKIP_PUBLISHのためここで終了します。");
      return;
    }
    await finishPublish(existingPr.number, existingPr.url, { slug, date, editionJa, articleUrl: `${PRODUCTION_URL}/news/${slug}/` });
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY が未設定です。ニュース生成には必須のため処理を中止します。");
  }

  // --- 1. 収集 + 記事生成（研究と執筆を1コールにまとめる） ---
  console.log("[news-publish] ニュースを収集・生成しています（OpenAI, web_search）...");
  const research = await withRetry(
    () => researchNews({ edition, date, excludeUrls: [...recentUrls] }, { apiKey, model: resolveNewsTextModel() }),
    { maxRetries: 2, onAttemptError: (err, attempt) => console.warn(`[news-publish] research失敗(試行${attempt + 1}): ${err.message}`) }
  );

  research.items = filterDuplicates(research.items, recentUrls);
  if (research.items.length === 0) {
    throw new Error("収集したニュースが全て直近で既出のため、公開対象がありません。");
  }
  console.log(`[news-publish] ニュース項目: ${research.items.length}件`);

  // --- 2. アイキャッチ生成（失敗したら記事を一切書き込まず中止する） ---
  console.log("[news-publish] アイキャッチを生成しています（OpenAI, gpt-image-1）...");
  const cover = await withRetry(
    () => generateNewsCover({ title: research.title, description: research.description, edition }, { apiKey, model: resolveNewsImageModel() }),
    { maxRetries: 2, onAttemptError: (err, attempt) => console.warn(`[news-publish] cover生成失敗(試行${attempt + 1}): ${err.message}`) }
  );

  // --- 3. Markdown組み立て + ローカル書き込み（画像・記事とも揃った時点で初めて書く = atomicity） ---
  const coverFileName = `${slug}-hero.${cover.ext}`;
  const markdown = buildNewsMarkdown({
    date,
    edition,
    publishedAtIso: publishedAtIso(date, edition),
    title: research.title,
    description: research.description,
    summary: research.summary,
    topics: research.topics,
    items: research.items,
    coverRelativePath: `./${coverFileName}`,
  });

  const newsDir = path.join(REPO_ROOT, "src/content/news");
  fs.mkdirSync(newsDir, { recursive: true });
  fs.writeFileSync(path.join(newsDir, `${slug}.md`), markdown, "utf8");
  fs.writeFileSync(path.join(newsDir, coverFileName), cover.buffer);
  console.log(`[news-publish] 記事・画像をローカルへ書き込みました: ${filePath}, src/content/news/${coverFileName}`);

  // --- 4. branch/commit/push ---
  // -B: 前回実行がpush前に失敗し、ローカルにbranchの残骸だけ残っているケースでも
  // クラッシュせずHEADから作り直す（この分岐に来る時点でopen PRは無いことを確認済み）。
  await git(["checkout", "-B", branch]);
  await git(["add", `src/content/news/${slug}.md`, `src/content/news/${coverFileName}`]);
  await git([
    "-c", "user.name=hobnova-news-bot",
    "-c", "user.email=actions@users.noreply.github.com",
    "commit", "-m", `Add ${editionJa} news for ${date}`,
  ]);
  await git(["push", "-u", "origin", branch]);

  // --- 5. PR作成 ---
  const prBody = [
    "## 概要",
    "",
    `NEWS自動投稿（${editionJa}）。OpenAI（web_search + ${resolveNewsTextModel()}）による収集・要約と、${resolveNewsImageModel()}によるアイキャッチ生成。`,
    "",
    `- 対象日: ${date}`,
    `- ニュース項目数: ${research.items.length}`,
    "",
    "自動生成コンテンツのため、マージ前に内容の事実確認を推奨します。",
    "",
    "🤖 Generated via news-publish.mjs",
  ].join("\n");

  const prUrl = await ghRaw([
    "pr", "create",
    "--base", "main",
    "--head", branch,
    "--title", `NEWS ${editionJa} ${date}`,
    "--body", prBody,
  ]);
  const prNumberMatch = prUrl.match(/\/pull\/(\d+)/);
  const prNumber = prNumberMatch ? Number(prNumberMatch[1]) : null;
  console.log(`[news-publish] PR作成: ${prUrl}`);
  if (!prNumber) throw new Error(`PR番号をURLから取得できませんでした: ${prUrl}`);

  if (skipPublish) {
    await notify(false, `🤖 HOBNOVA NEWS ${editionJa}\n\n${date}分のPRを作成しました（SKIP_PUBLISHのため自動マージは行っていません）。\n${prUrl}`);
    console.log("[news-publish] SKIP_PUBLISHのためここで終了します。");
    return;
  }

  await finishPublish(prNumber, prUrl, { slug, date, editionJa, articleUrl: `${PRODUCTION_URL}/news/${slug}/` });
}

// --- 6. CI待機 -> merge -> 本番deploy待ち -> 本番URL確認（通常フロー・既存PR再開フローの共通処理） ---
async function finishPublish(prNumber, prUrl, { date, editionJa, articleUrl }) {
  console.log("[news-publish] CI完了を待っています...");
  const ciResult = await waitForPrCiGreen(prNumber);
  if (!ciResult.ok) {
    await notify(
      false,
      `🚨 HOBNOVA NEWS ${editionJa}\n\nPRを作成しましたが、CIがタイムアウト内にgreenになりませんでした。\n${prUrl}\n手動で確認してください。`
    );
    process.exitCode = 1;
    return;
  }

  console.log(`[news-publish] PR #${prNumber}をsquash mergeします。`);
  const merge = await squashMergePR(prNumber);
  if (!merge.commitSha) throw new Error(`PR #${prNumber}のmergeに失敗しました。`);
  console.log(`[news-publish] マージ完了: ${merge.commitSha}`);

  console.log("[news-publish] 本番デプロイの完了を待っています...");
  const deploy = await waitForProductionDeploy(merge.commitSha);
  if (!deploy.completed || !deploy.success) {
    await notify(
      false,
      `🚨 HOBNOVA NEWS ${editionJa}\n\nマージしましたが、本番デプロイの確認に失敗しました。\nCommit: ${merge.commitSha}\n${prUrl}`
    );
    process.exitCode = 1;
    return;
  }

  try {
    const res = await fetch(articleUrl);
    if (!res.ok) {
      await notify(false, `🚨 HOBNOVA NEWS ${editionJa}\n\n公開しましたが本番ページが${res.status}を返しました。\n${articleUrl}\n${prUrl}`);
      process.exitCode = 1;
      return;
    }
  } catch (err) {
    await notify(false, `🚨 HOBNOVA NEWS ${editionJa}\n\n本番URL確認中にエラーが発生しました: ${err.message}\n${articleUrl}\n${prUrl}`);
    process.exitCode = 1;
    return;
  }

  await notify(
    false,
    `✅ HOBNOVA NEWS ${editionJa}\n\n${date}分のニュースを公開しました。\n${articleUrl}\n\nPR #${prNumber}: ${prUrl}`
  );
  console.log("[news-publish] 完了しました。");
}

// todayJst/publishedAtIsoの単体テストがこのファイルをimportするため、
// importするだけでmain()が実行されないようガードする
// （daily-publish-check.mjs/notify-article-ready.mjsで実際に発生した不具合と同じ対策）。
const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  main().catch((error) => {
    // Secret値・APIレスポンス本文はログへ出さない（error.messageのみ）。
    console.error(`[news-publish] ${error.message}`);
    process.exitCode = 1;
  });
}
