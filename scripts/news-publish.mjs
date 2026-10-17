#!/usr/bin/env node
// NEWS朝版/夜版の自動投稿パイプライン。
// 収集(OpenAI web_search) -> 重複除外 -> 記事生成 -> アイキャッチ生成 -> ローカルcheck/build
// -> news collectionへ保存 -> branch/commit/push -> PR作成 -> LINE通知（確認待ち） -> 停止
//
// 方針（2026-10-18改訂）: docs/ai-article-guidelines.md 9章「最終Mergeは必ず人間が行う。」に
// 従い、このスクリプトは「レビュー可能なPRを準備する」までしか行わない。mainへのmerge・
// 本番デプロイ確認は一切行わない（以前のバージョンはCI green後にsquash mergeまで自動で
// 行っていたが、AI生成記事は人間の最終確認を経るという既存運用ルールに反していたため撤廃）。
//
// daily-publish-check.mjs（通常記事、JST12:00、1日1本、CI green前提でsquash mergeまで行う）
// とは完全に独立したscheduler/スクリプト。対象ディレクトリ（src/content/news/）・PR検出方式
// （自分で作ったPR番号を直接扱う。既存PRを検索するdaily-publish-check.mjsの方式は使わない）
// のどちらも重複しない設計。
//
// 重要: このスクリプトの実行（DRY_RUN無し、SKIP_PUBLISH無し）はOpenAI APIへの課金が必ず発生する
// （research 1回 + cover画像生成 1回）。DRY_RUNで十分に確認してから実行すること。
//
// GitHub Actionsの既知の仕様: ジョブ内のGITHUB_TOKENで作成したPRのpull_requestイベントは、
// 新しいworkflow実行をトリガーしない（無限ループ防止のための仕様。
// https://docs.github.com/en/actions/using-workflows/triggering-a-workflow#triggering-a-workflow-from-a-workflow ）。
// そのため pr-check.yml の必須check「astro check & build」はこのPRでは自動発火しない可能性が
// 高い（本セッションでは実機再現検証はしていない。GitHub公式ドキュメントに基づく判断）。
// このスクリプトは同じcheck/buildを自分のjob内で事前に実行し、結果をPR本文・LINE通知に
// 含めることでこの制約を補う。mainへのmerge可否は人間が判断する。
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
import { isLineConfigured, sendLinePush } from "./lib/line-push.mjs";

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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

async function run(cmd, args, opts = {}) {
  const { stdout } = await execFileAsync(cmd, args, { cwd: REPO_ROOT, maxBuffer: 10 * 1024 * 1024, ...opts });
  return stdout.trim();
}

async function git(args) {
  return run("git", args);
}

async function ghRaw(args) {
  return run("gh", args);
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
 * このslug用のbranchに既に開いているPRがあれば返す（前回実行が失敗後にbranch/PRだけ
 * 残っている場合の再実行に対応する。無ければ毎回research/coverを再実行して課金が重複し、
 * かつgit push/gh pr createがnon-fast-forward/重複PRで失敗する）。
 */
async function findOpenPrForBranch(branch) {
  const output = await ghRaw(["pr", "list", "--head", branch, "--state", "open", "--json", "number,url", "--limit", "1"]);
  const list = JSON.parse(output || "[]");
  return list[0] ? { number: list[0].number, url: list[0].url } : null;
}

/** pr-check.ymlと同じcheckをこのjob内で事前に実行する（GITHUB_TOKEN起点PRではそちらが
 * 自動発火しない可能性があるため）。戻り値のokがfalseならPRを作成しない。 */
async function runLocalCheck() {
  const steps = [
    { label: "astro check", cmd: "npx", args: ["astro", "check"] },
    { label: "build", cmd: "npm", args: ["run", "build"] },
  ];
  for (const step of steps) {
    try {
      await run(step.cmd, step.args);
      console.log(`[news-publish] local check OK: ${step.label}`);
    } catch (err) {
      return { ok: false, failedStep: step.label, message: err.message };
    }
  }
  return { ok: true };
}

const REVIEW_NOTE = [
  "⚠️ GitHub Actionsの仕様により、このPRでは`pr-check.yml`のrequired check「astro check & build」が自動発火しない場合があります",
  "（GITHUB_TOKEN起点で作成されたPRのpull_requestイベントは新しいworkflow実行をトリガーしないため）。",
  "このjob内で同じcheck/buildを事前実行済みです（結果は上記参照）。",
  "mergeボタンが無効なままの場合は、このbranchへご自身の認証で軽微なcommitをpush（例: GitHub Web UIでのファイル編集）すると",
  "pull_requestイベントが正常に発火し、required checkが実行されます。",
].join("\n");

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
  // この判定はAI生成記事が実際にmainへmergeされた後の状態を見るものなので、mergeを人間が
  // 行う今回の方針でも変わらず必要（人間がmergeした後の再実行で再度PRを作らないため）。
  if (fs.existsSync(path.join(REPO_ROOT, filePath))) {
    console.log(`[news-publish] ${filePath} は既に存在します。本日分の${edition}版は公開済みのため終了します。`);
    return;
  }

  const recentUrls = collectRecentSourceUrls(REPO_ROOT, { today: new Date(`${date}T00:00:00Z`) });
  console.log(`[news-publish] 直近の既出source URL: ${recentUrls.size}件（重複除外対象）`);

  // 前回実行がPR作成までで中断した、または単にまだ人間がレビュー中の場合、branchに既に
  // open PRがある可能性がある。その場合はresearch/coverを再実行せず（課金重複防止）、
  // 既存PRの案内のみ再送する。
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
      console.log(`  既存PRを検出: #${existingPr.number} (${existingPr.url})。実行時はresearch/coverを再生成せずこのPRの案内のみ再送します。`);
    }
    console.log("[news-publish] dry-run: OpenAI APIは呼び出しません。GitHubへの書き込みも行いません。mergeはこのスクリプトでは一切行いません（人間が行います）。");
    return;
  }

  if (existingPr) {
    console.log(`[news-publish] ブランチ${branch}の既存PRを検出: #${existingPr.number} (${existingPr.url})。再生成せず案内のみ再送します。`);
    await notify(
      false,
      `🤖 HOBNOVA NEWS ${editionJa}\n\n${date}分のPRは既に作成済みです。レビュー・mergeをお願いします。\n${existingPr.url}`
    );
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

  if (skipPublish) {
    console.log("[news-publish] SKIP_PUBLISH: git/PR操作は行わず、生成結果のみ報告してここで終了します。");
    await notify(
      true,
      `🤖 HOBNOVA NEWS ${editionJa} (SKIP_PUBLISH)\n\n記事を生成しました（PR作成・commit/pushは行っていません）。\n\n📄 ${research.title}\n📝 ${research.description}\n項目数: ${research.items.length}\nローカルパス: ${filePath}`
    );
    return;
  }

  // --- 4. ローカルcheck（pr-check.ymlと同じ内容。壊れた内容ではPRを作らない） ---
  console.log("[news-publish] ローカルでastro check / buildを実行しています...");
  const localCheck = await runLocalCheck();
  if (!localCheck.ok) {
    throw new Error(`ローカルcheckに失敗したため、PRを作成せず中止します（${localCheck.failedStep}）: ${localCheck.message}`);
  }

  // --- 5. branch/commit/push ---
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

  // --- 6. PR作成（mainへのmergeはここでは行わない。最終判断は人間。） ---
  const prBody = [
    "## 概要",
    "",
    `NEWS自動投稿（${editionJa}）。OpenAI（web_search + ${resolveNewsTextModel()}）による収集・要約と、${resolveNewsImageModel()}によるアイキャッチ生成。`,
    "",
    `- 対象日: ${date}`,
    `- ニュース項目数: ${research.items.length}`,
    `- ローカルcheck（astro check / build）: PASS`,
    "",
    "自動生成コンテンツのため、内容の事実確認の上で人間がmergeしてください。このPRは自動でmergeされません。",
    "",
    REVIEW_NOTE,
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

  await notify(
    false,
    `🤖 HOBNOVA NEWS ${editionJa}\n\n${date}分のPRを作成しました（ローカルcheck PASS）。\n内容を確認し、問題なければGitHubでmergeしてください。本番公開は人間のmerge後に行われます。\n${prUrl}`
  );
  console.log("[news-publish] PR作成完了。mergeは人間が行うため、ここで終了します。");
}

// news-publish.mjs/daily-publish-check.mjs/notify-article-ready.mjsで実際に発生した「importする
// だけでmain()が実行されてしまう」不具合と同じ対策。テストがこのファイルをimportしても
// main()が走らないようガードする。
const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  main().catch((error) => {
    // Secret値・APIレスポンス本文はログへ出さない（error.messageのみ）。
    console.error(`[news-publish] ${error.message}`);
    process.exitCode = 1;
  });
}
